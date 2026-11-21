
from pathlib import Path
import uuid

import chromadb
from chromadb.utils.embedding_functions import DefaultEmbeddingFunction
import os


DB_PATH = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent.parent)) / "chroma_db"

client = chromadb.PersistentClient(path=str(DB_PATH))

embedding_function = DefaultEmbeddingFunction()

collection = client.get_or_create_collection(
    name="trust_rag_documents",
    embedding_function=embedding_function,
    metadata={"hnsw:space": "cosine"}
)


def find_document_by_hash(
    content_hash: str,
    user_id: int
) -> str | None:
    """Find an existing document belonging to this user."""

    results = collection.get(
        where={
            "$and": [
                {"content_hash": content_hash},
                {"user_id": user_id}
            ]
        },
        include=["metadatas"]
    )

    metadatas = results.get("metadatas") or []

    if not metadatas:
        return None

    return metadatas[0]["document_id"]


def add_document_chunks(
    document_id: str,
    filename: str,
    chunks: list[str],
    content_hash: str,
    user_id: int
):
    """Store document chunks with their owner's user ID."""

    if not chunks:
        raise ValueError("No chunks provided.")

    # Delete only chunks belonging to this user and document
    collection.delete(
        where={
            "$and": [
                {"document_id": document_id},
                {"user_id": user_id}
            ]
        }
    )

    ids = [
        f"{document_id}_{index}_{uuid.uuid4().hex[:8]}"
        for index in range(len(chunks))
    ]

    metadatas = [
        {
            "document_id": document_id,
            "filename": filename,
            "chunk_index": index,
            "content_hash": content_hash,
            "user_id": user_id
        }
        for index in range(len(chunks))
    ]

    collection.add(
        ids=ids,
        documents=chunks,
        metadatas=metadatas
    )

    return {
        "stored_chunks": len(chunks),
        "document_id": document_id
    }

def list_user_documents(user_id: int):
    """List unique documents belonging to a user."""

    results = collection.get(
        where={"user_id": user_id},
        include=["metadatas"]
    )

    documents = {}

    for metadata in results.get("metadatas") or []:
        document_id = metadata["document_id"]

        if document_id not in documents:
            documents[document_id] = {
                "id": document_id,
                "name": metadata["filename"],
                "chunks": 0
            }

        documents[document_id]["chunks"] += 1

    return list(documents.values())


def search_documents(
    question: str,
    user_id: int,
    n_results: int = 3,
    document_id: str | None = None
):
    """Search only documents belonging to the logged-in user."""

    if not question.strip():
        raise ValueError("Question cannot be empty.")

    # Every search must filter by the user's ID
    search_filter = {"user_id": user_id}

    # If a document ID is provided, filter by both fields
    if document_id:
        search_filter = {
            "$and": [
                {"user_id": user_id},
                {"document_id": document_id}
            ]
        }

    matching_chunks = collection.get(
        where=search_filter,
        include=[]
    )

    total_chunks = len(matching_chunks["ids"])

    if total_chunks == 0:
        return []

    results = collection.query(
        query_texts=[question],
        n_results=min(n_results, total_chunks),
        where=search_filter,
        include=["documents", "metadatas", "distances"]
    )

    matches = []

    for index, chunk in enumerate(results["documents"][0]):
        matches.append({
            "text": chunk,
            "metadata": results["metadatas"][0][index],
            "distance": results["distances"][0][index]
        })

    return matches
