
import sqlite3
from pathlib import Path

# Store the database inside the backend folder
DB_PATH = Path(__file__).resolve().parent.parent / "users.db"


# 1. Create the users table
def init_db():
    with sqlite3.connect(DB_PATH) as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


# 2. Create a new user
def create_user(email: str, password_hash: str):
    with sqlite3.connect(DB_PATH) as connection:
        cursor = connection.execute(
            """
            INSERT INTO users (email, password_hash)
            VALUES (?, ?)
            """,
            (email, password_hash)
        )

        return cursor.lastrowid


# 3. Find a user by email
def get_user_by_email(email: str):
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        user = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        return dict(user) if user else None


# 4. Find a user by ID
def get_user_by_id(user_id: int):
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row

        user = connection.execute(
            "SELECT id, email, created_at FROM users WHERE id = ?",
            (user_id,)
        ).fetchone()

        return dict(user) if user else None
