"""
Service for querying indexed code and generating answers.
"""

import os
import anthropic
from psycopg_pool import ConnectionPool
from pgvector.psycopg import register_vector
from typing import List, Dict


# Import shared embedding function
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from flows import code_to_embedding


class QueryService:
    """
    Handles searching code and generating AI answers.
    """

    def __init__(self):
        """Initialize query service with LLM and database connections."""
        self.claude_client = anthropic.Anthropic(
            api_key=os.getenv("ANTHROPIC_API_KEY")
        )
        self.db_pool = ConnectionPool(os.getenv("APP_DATABASE_URL"))

    def search_code(
        self,
        project_id: str,
        query: str,
        limit: int = 10
    ) -> List[Dict]:
        """
        Search code using vector similarity.

        Args:
            project_id: Project identifier
            query: Search query text
            limit: Maximum number of results

        Returns:
            List of code chunks with similarity scores
        """
        # Generate query embedding using SAME function as indexing
        query_embedding = code_to_embedding.eval(query)

        table_name = f"embeddings_{project_id.replace('-', '_')}"

        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Vector similarity search using pgvector
                # <=> is cosine distance operator
                cur.execute(f"""
                    SELECT
                        filename,
                        code,
                        language,
                        start_line,
                        end_line,
                        embedding <=> %s AS distance
                    FROM {table_name}
                    ORDER BY distance
                    LIMIT %s
                """, (query_embedding, limit))

                results = cur.fetchall()

                return [
                    {
                        "filename": row[0],
                        "code": row[1],
                        "language": row[2],
                        "start_line": row[3],
                        "end_line": row[4],
                        "similarity": round(1.0 - row[5], 3)  # Convert distance to similarity
                    }
                    for row in results
                ]

    def ask_llm(self, query: str, code_context: List[Dict]) -> str:
        """
        Ask Claude to answer question based on code context.

        Args:
            query: User's question
            code_context: List of relevant code chunks

        Returns:
            AI-generated answer
        """
        # Build context from search results
        context_text = ""
        for i, result in enumerate(code_context, 1):
            context_text += f"\n\n### Source {i}: {result['filename']}"
            context_text += f" (lines {result['start_line']}-{result['end_line']})\n"
            context_text += f"```{result['language']}\n{result['code']}\n```"

        # Create prompt for Claude
        system_prompt = """You are a code assistant helping developers understand codebases.

Your job is to answer questions about code based on the provided context.

Guidelines:
1. Give clear, concise answers
2. Reference specific files and line numbers when relevant
3. Use code examples from the context when helpful
4. If the context doesn't contain enough information, say so
5. Format code blocks with proper syntax highlighting
6. Be precise and technical"""

        user_prompt = f"""Based on the following code from the repository, please answer this question:

**Question:** {query}

**Relevant Code:**
{context_text}

Please provide a detailed answer with references to the specific files and code shown above."""

        # Ask Claude
        message = self.claude_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=2000,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": user_prompt
            }]
        )

        return message.content[0].text

    def query(self, project_id: str, question: str) -> Dict:
        """
        Complete query pipeline: search + LLM answer.

        Args:
            project_id: Project identifier
            question: User's question

        Returns:
            Dictionary with answer and sources
        """
        # 1. Search for relevant code
        search_results = self.search_code(project_id, question, limit=10)

        if not search_results:
            return {
                "answer": "No relevant code found in the repository.",
                "sources": []
            }

        # 2. Get LLM answer with context
        answer = self.ask_llm(question, search_results)

        # 3. Return answer + top sources
        return {
            "answer": answer,
            "sources": search_results[:5]  # Return top 5 sources
        }
