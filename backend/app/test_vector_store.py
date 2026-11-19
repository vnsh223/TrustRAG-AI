
from app.vector_store import add_document_chunks, search_documents

# Sample document chunks
chunks = [
    "TrustRAG AI is a secure document question-answering system.",
    "The system uses ChromaDB to store document embeddings.",
    "Groq API will generate answers using retrieved document context."
]

# Store sample chunks
result = add_document_chunks(
    document_id="test_document_001",
    filename="test_document.txt",
    chunks=chunks
)

print("Storage result:", result)

# Search using a natural-language question
results = search_documents(
    "Which database stores document embeddings?",
    n_results=2
)

print("\nSearch results:")

for item in results:
    print("\nDocument:", item["metadata"]["filename"])
    print("Chunk:", item["text"])
    print("Distance:", item["distance"])
