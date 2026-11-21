
from pathlib import Path
from uuid import uuid4
from zipfile import BadZipFile
from hashlib import sha256
from typing import Literal
import sqlite3
import os

from fastapi import Depends, FastAPI, UploadFile, File, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import EmailStr

from app.database import (
    init_db,
    create_user,
    get_user_by_email
)

from app.auth import (
    hash_password,
    verify_password,
    create_access_token
)

from app.database import (
    init_db,
    create_user,
    get_user_by_email,
    get_user_by_id
)
from app.auth import (
    hash_password,
    verify_password,
    create_access_token,
    verify_access_token
)

from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pypdf.errors import PdfReadError
from app.guardrails import (
    validate_question,
    validate_retrieved_context,
    validate_generated_answer
)

from app.document_processor import extract_text
from app.guardrails import detect_prompt_injection
from app.document_chunker import split_text
from app.vector_store import (
    add_document_chunks,
    search_documents,
    find_document_by_hash,
    list_user_documents
)
from app.llm_service import generate_answer, generate_general_answer
from app.judge_service import judge_answer


# --------------------------------------------------
# FastAPI application
# --------------------------------------------------

app = FastAPI(
    title="TrustRAG AI",
    description="Secure and reliable RAG application",
    version="1.0.0"
)


# --------------------------------------------------
# Request models
# --------------------------------------------------

class SearchRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    document_id: str | None = None
    top_k: int = Field(default=3, ge=1, le=10)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    document_id: str | None = None
    top_k: int = Field(default=3, ge=1, le=10)

    answer_mode: Literal["strict", "general"] = "strict"

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)

# Initialize user database
init_db()


# --------------------------------------------------
# Authentication dependency
# --------------------------------------------------

security = HTTPBearer()

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    # Read token from Authorization header
    token = credentials.credentials

    # Verify token and extract user ID
    user_id = verify_access_token(token)

    # Confirm that user still exists
    user = get_user_by_id(user_id)

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User account not found."
        )

    return user


# --------------------------------------------------
# User registration
# --------------------------------------------------

@app.post("/auth/register", status_code=201)
def register_user(request: RegisterRequest):

    email = str(request.email).strip().lower()

    # Check bcrypt's maximum password length
    if len(request.password.encode("utf-8")) > 72:
        raise HTTPException(
            status_code=400,
            detail="Password is too long."
        )

    # Hash password
    password_hash = hash_password(request.password)

    try:
        user_id = create_user(
            email=email,
            password_hash=password_hash
        )

    except sqlite3.IntegrityError:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists."
        )

    return {
        "message": "Account created successfully.",
        "user_id": user_id,
        "email": email
    }


# --------------------------------------------------
# User login
# --------------------------------------------------

@app.post("/auth/login")
def login_user(request: LoginRequest):

    email = str(request.email).strip().lower()

    user = get_user_by_email(email)

    if not user or not verify_password(
        request.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    access_token = create_access_token(user["id"])

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user_id": user["id"],
        "email": user["email"]
    }

# --------------------------------------------------
# Frontend connection
# --------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------
# Upload settings
# --------------------------------------------------

UPLOAD_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent)) / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Maximum upload size: 50 MB
MAX_FILE_SIZE = 50 * 1024 * 1024

# Read uploaded files in 1 MB portions
READ_CHUNK_SIZE = 1024 * 1024

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


# --------------------------------------------------
# Home endpoint
# --------------------------------------------------

@app.get("/")
def home():
    return {
        "message": "Welcome to TrustRAG AI API"
    }


# --------------------------------------------------
# Health check endpoint
# --------------------------------------------------

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "TrustRAG AI Backend"
    }

# --------------------------------------------------
# List documents belonging to the logged-in user
# --------------------------------------------------

@app.get("/documents")
def get_user_documents(
    current_user: dict = Depends(get_current_user)
):
    documents = list_user_documents(
        user_id=current_user["id"]
    )

    return {
        "total_documents": len(documents),
        "documents": documents
    }

# --------------------------------------------------
# Document upload endpoint
# --------------------------------------------------

@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user)
):

    original_name = file.filename or ""
    extension = Path(original_name).suffix.lower()

    # Validate file extension
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX and TXT files are allowed."
        )

    # --------------------------------------------------
    # Read file safely in smaller chunks
    # --------------------------------------------------

    file_parts = []
    total_size = 0

    try:
        while True:

            # Read a small portion of the uploaded file
            chunk = await file.read(READ_CHUNK_SIZE)

            # Stop when no more data remains
            if not chunk:
                break

            total_size += len(chunk)

            # Reject files larger than the limit
            if total_size > MAX_FILE_SIZE:
                raise HTTPException(
                    status_code=413,
                    detail="File size must not exceed 50 MB."
                )

            file_parts.append(chunk)

    finally:
        await file.close()

    # Combine file chunks after checking size
    content = b"".join(file_parts)

    if not content:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty."
        )

    # --------------------------------------------------
    # Extract document text
    # --------------------------------------------------

    try:
        extracted_text = extract_text(content, extension)

    except (
        PdfReadError,
        BadZipFile,
        UnicodeDecodeError,
        ValueError
    ) as error:

        raise HTTPException(
            status_code=422,
            detail=f"Could not process document: {error}"
        )

    # --------------------------------------------------
    # Normalize extracted text
    # --------------------------------------------------

    normalized_text = " ".join(extracted_text.split())

    if not normalized_text:
        raise HTTPException(
            status_code=422,
            detail="Document contains no usable text."
        )

    # --------------------------------------------------
    # Generate content hash
    # --------------------------------------------------

    content_hash = sha256(
        normalized_text.encode("utf-8")
    ).hexdigest()

    # --------------------------------------------------
    # Split extracted text into chunks
    # --------------------------------------------------

    chunks = split_text(extracted_text)

    if not chunks:
        raise HTTPException(
            status_code=422,
            detail="Document contains no usable text."
        )

    # --------------------------------------------------
    # Duplicate detection
    # --------------------------------------------------

    try:
        existing_document_id = find_document_by_hash(
            content_hash=content_hash,
            user_id=current_user["id"]
        )

    except Exception as error:

        print("DUPLICATE CHECK ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Could not check for duplicate documents."
        )

    if existing_document_id:

        # Reuse existing ID for identical normalized content
        document_id = existing_document_id

    else:

        # Assign a new ID to a new document
        document_id = str(uuid4())

    # --------------------------------------------------
    # Save uploaded file
    # --------------------------------------------------

    # Create a separate upload folder for each user
    user_upload_dir = UPLOAD_DIR / str(current_user["id"])
    user_upload_dir.mkdir(parents=True, exist_ok=True)

    # Save the document inside that user's folder
    stored_path = user_upload_dir / f"{document_id}{extension}"

    try:
        stored_path.write_bytes(content)

    except OSError as error:

        print("FILE STORAGE ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Uploaded file could not be saved."
        )

    # --------------------------------------------------
    # Store document chunks in ChromaDB
    # --------------------------------------------------

    try:

        storage_result = add_document_chunks(
            document_id=document_id,
            filename=original_name,
            chunks=chunks,
            content_hash=content_hash,
            user_id=current_user["id"]
        )

    except Exception as error:

        print("VECTOR STORAGE ERROR:", repr(error))

        raise HTTPException(
            status_code=500,
            detail="Document could not be stored in the vector database."
        )

    # --------------------------------------------------
    # Upload response
    # --------------------------------------------------

    return {
        "message": "Document uploaded and indexed successfully",
        "document_id": document_id,
        "filename": original_name,
        "file_type": extension,
        "file_size": total_size,
        "character_count": len(extracted_text),
        "total_chunks": storage_result["stored_chunks"],
        "text_preview": extracted_text[:1000]
    }


# --------------------------------------------------
# Document search endpoint
# --------------------------------------------------

@app.post("/documents/search")
def search_document(
    request: SearchRequest,
    current_user: dict = Depends(get_current_user)
):

    try:

        results = search_documents(
            question=request.question,
            n_results=request.top_k,
            user_id=current_user["id"],
            document_id=request.document_id
        )

        return {
            "question": request.question,
            "total_results": len(results),
            "results": results
        }

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )


# --------------------------------------------------
# RAG chat endpoint
# --------------------------------------------------


@app.post("/chat")
def chat_with_document(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user)
):

    # --------------------------------------------------
    # Step 0: Validate user question
    # --------------------------------------------------

    try:

        question = validate_question(request.question)

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )
    # Check for possible prompt injection

        # --------------------------------------------------
    # Step 0.5: Block prompt injection
    # --------------------------------------------------

    if detect_prompt_injection(question):

        print("SECURITY: Prompt injection blocked.")

        return {
            "question": question,
            "answer": None,
            "status": "BLOCK",
            "message": (
                "Your request contains suspicious instructions "
                "that cannot be processed in document mode."
            ),
            "total_sources": 0,
            "sources": []
        }

    # --------------------------------------------------
    # Step 1: Retrieve relevant document chunks
    # --------------------------------------------------

    try:

        results = search_documents(
            question=question,
            n_results=request.top_k,
            user_id=current_user["id"],
            document_id=request.document_id
        )

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    # --------------------------------------------------
    # Step 2: Handle empty retrieval results
    # --------------------------------------------------

    if not results:

        return {
            "question": question,
            "answer": None,
            "status": "BLOCK",
            "message": (
                "Your document does not contain enough "
                "information to answer this question. "
                "Try general mode or upload a relevant document."
            ),
            "total_sources": 0,
            "sources": []
        }

    # --------------------------------------------------
    # Step 3: Validate retrieved document chunks
    # --------------------------------------------------

    try:

        results = validate_retrieved_context(results)

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error)
        )

    # --------------------------------------------------
    # Step 4: Prepare context and source information
    # --------------------------------------------------

    context_parts = []
    sources = []

    for index, result in enumerate(results, start=1):

        metadata = result["metadata"]

        context_parts.append(
            f"[{index}]\n{result['text']}"
        )

        sources.append({
            "source_number": index,
            "filename": metadata.get("filename"),
            "document_id": metadata.get("document_id"),
            "chunk_index": metadata.get("chunk_index"),
            "text": result["text"]
        })

    context = "\n\n".join(context_parts)

    # --------------------------------------------------
    # Step 5: General AI answer mode
    # --------------------------------------------------

    if request.answer_mode == "general":

        try:

            answer = generate_general_answer(
                question=question,
                context=context
            )

        except Exception as error:

            print("GENERAL GENERATION ERROR:", repr(error))

            raise HTTPException(
                status_code=502,
                detail="General AI answer generation failed."
            )

        # Validate generated answer
        try:

            answer = validate_generated_answer(answer)

        except ValueError as error:

            print("GENERAL ANSWER VALIDATION ERROR:", repr(error))

            raise HTTPException(
                status_code=502,
                detail="AI generated an invalid answer."
            )

        return {
            "question": question,
            "answer": answer,
            "status": "GENERAL_UNVERIFIED",
            "message": (
                "This answer uses general AI knowledge and "
                "has not been verified against your document."
            ),
            "generation_model": "Qwen",
            "document_verified": False,
            "total_sources": len(sources),
            "sources": sources
        }

    # --------------------------------------------------
    # Step 6: Strict document-grounded mode
    # --------------------------------------------------

    try:

        answer = generate_answer(
            question=question,
            context=context
        )

    except Exception as error:

        print("GENERATION ERROR:", repr(error))

        raise HTTPException(
            status_code=502,
            detail="AI answer generation failed. Please try again."
        )

    # --------------------------------------------------
    # Step 7: Validate generated answer
    # --------------------------------------------------

    try:

        answer = validate_generated_answer(answer)

    except ValueError as error:

        print("ANSWER VALIDATION ERROR:", repr(error))

        raise HTTPException(
            status_code=502,
            detail="AI generated an invalid answer."
        )

    # --------------------------------------------------
    # Step 8: Verify answer using GPT-OSS
    # --------------------------------------------------

    try:

        evaluation = judge_answer(
            question=question,
            context=context,
            answer=answer
        )

    except Exception as error:

        print("JUDGE ERROR:", repr(error))

        raise HTTPException(
            status_code=502,
            detail="Answer verification failed. The answer was not released."
        )

    # --------------------------------------------------
    # Step 9: Handle BLOCK and REVIEW
    # --------------------------------------------------

    print("Judge evaluation:", evaluation)

    if evaluation["verdict"] != "PASS":

        if not evaluation["grounded"]:

            user_message = (
                "The answer could not be verified because "
                "some information was not supported by "
                "your uploaded document."
            )

        elif not evaluation["relevant"]:

            user_message = (
                "Your document does not contain enough "
                "information to answer this question. "
                "Try general mode or upload a relevant document."
            )

        else:

            user_message = (
                "The answer needs additional verification "
                "before it can be displayed."
            )

        return {
            "question": question,
            "answer": None,
            "status": evaluation["verdict"],
            "message": user_message,
            "judge_result": evaluation,
            "generation_model": "Qwen",
            "judge_model": "GPT-OSS",
            "document_verified": False,
            "total_sources": len(sources),
            "sources": sources
        }

    # --------------------------------------------------
    # Step 10: Return verified answer
    # --------------------------------------------------

    return {
        "question": question,
        "answer": answer,
        "status": "VERIFIED",
        "generation_model": "Qwen",
        "judge_model": "GPT-OSS",
        "document_verified": True,
        "judge_result": evaluation,
        "total_sources": len(sources),
        "sources": sources
    }
