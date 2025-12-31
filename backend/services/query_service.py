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
        """Initialize query service with database connection."""
        self.db_pool = ConnectionPool(os.getenv("APP_DATABASE_URL"))

    def search_code(
        self,
        project_id: str,
        query: str,
        limit: int = 10,
        similarity_threshold: float = 0.5
    ) -> List[Dict]:
        """
        Search code using vector similarity.

        Args:
            project_id: Project identifier
            query: Search query text
            limit: Maximum number of results
            similarity_threshold: Minimum similarity score (0.0-1.0) to include results

        Returns:
            List of code chunks with similarity scores above threshold
        """
        # Generate query embedding using SAME function as indexing
        query_embedding = code_to_embedding.eval(query)

        table_name = f"embeddings_{project_id.replace('-', '_')}"

        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Vector similarity search using pgvector
                # <=> is cosine distance operator
                # We fetch more results and filter by threshold
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
                """, (query_embedding, limit * 2))  # Fetch 2x to account for filtering

                results = cur.fetchall()

                # Filter by similarity threshold and limit results
                filtered_results = []
                for row in results:
                    similarity = round(1.0 - row[5], 3)  # Convert distance to similarity
                    if similarity >= similarity_threshold:
                        filtered_results.append({
                            "filename": row[0],
                            "code": row[1],
                            "language": row[2],
                            "start_line": row[3],
                            "end_line": row[4],
                            "similarity": similarity
                        })
                        if len(filtered_results) >= limit:
                            break

                return filtered_results

    def ask_llm(self, query: str, code_context: List[Dict]) -> str:
        """
        Ask Claude to answer question based on code context.

        Args:
            query: User's question
            code_context: List of relevant code chunks

        Returns:
            AI-generated answer
        """
        # Get API key from environment (set by settings API)
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("Anthropic API key not configured. Please set it in Settings.")

        # Create client with current API key
        claude_client = anthropic.Anthropic(api_key=api_key)

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

        # Adjust prompt based on whether we have code context
        if code_context:
            user_prompt = f"""Based on the following code from the repository, please answer this question:

**Question:** {query}

**Relevant Code:**
{context_text}

Please provide a detailed answer with references to the specific files and code shown above."""
        else:
            user_prompt = f"""I couldn't find any relevant code in the repository matching the search query.

**Question:** {query}

**Status:** No code with sufficient similarity was found in the semantic search (similarity threshold: 0.5).

Please help the user by:
1. Explaining why no relevant code might have been found
2. Suggesting alternative search terms or approaches they could try
3. If the query seems to reference a specific term (like a variable, function, or class name), explain that it might not exist in this codebase or suggest checking the spelling
4. Be helpful and constructive in your response"""

        # Ask Claude
        message = claude_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=2000,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": user_prompt
            }]
        )

        return message.content[0].text

    def query(self, project_id: str, question: str, mode: str = None) -> Dict:
        """
        Complete query pipeline: search + optional LLM answer.

        Args:
            project_id: Project identifier
            question: User's question
            mode: 'search' for search-only, 'ai' for full Q&A, None for auto-detect

        Returns:
            Dictionary with answer, sources, mode, and has_llm_answer
        """
        # 1. Search for relevant code (always works without API key)
        search_results = self.search_code(project_id, question, limit=10)

        # If user explicitly requested search mode, skip LLM
        if mode == 'search':
            if not search_results:
                return {
                    "answer": None,
                    "sources": [],
                    "mode": "search_only",
                    "has_llm_answer": False,
                    "search_message": "No relevant code found matching your query. Try rephrasing or using different keywords."
                }
            return {
                "answer": None,
                "sources": search_results[:5],
                "mode": "search_only",
                "has_llm_answer": False
            }

        # 2. Check if API key is configured
        anthropic_key = os.getenv("ANTHROPIC_API_KEY")
        openai_key = os.getenv("OPENAI_API_KEY")
        openrouter_key = os.getenv("OPENROUTER_API_KEY")

        has_api_key = bool(anthropic_key or openai_key or openrouter_key)

        # If user explicitly requested AI mode, try LLM (requires API key)
        if mode == 'ai':
            if not has_api_key:
                # No API key configured
                if not search_results:
                    return {
                        "answer": None,
                        "sources": [],
                        "mode": "search_only",
                        "has_llm_answer": False,
                        "llm_error": "API key required for AI mode. Please configure in Settings.",
                        "search_message": "No relevant code found matching your query. Try rephrasing or using different keywords."
                    }
                return {
                    "answer": None,
                    "sources": search_results[:5],
                    "mode": "search_only",
                    "has_llm_answer": False,
                    "llm_error": "API key required for AI mode. Please configure in Settings."
                }

            # API key exists, call LLM
            try:
                answer = self.ask_llm(question, search_results)
                return {
                    "answer": answer,
                    "sources": search_results[:5] if search_results else [],
                    "mode": "full",
                    "has_llm_answer": True,
                    "search_message": "No relevant code found matching your query." if not search_results else None
                }
            except Exception as e:
                # If LLM fails, return appropriate message
                if not search_results:
                    return {
                        "answer": None,
                        "sources": [],
                        "mode": "search_only",
                        "has_llm_answer": False,
                        "llm_error": str(e),
                        "search_message": "No relevant code found matching your query. Try rephrasing or using different keywords."
                    }
                return {
                    "answer": None,
                    "sources": search_results[:5],
                    "mode": "search_only",
                    "has_llm_answer": False,
                    "llm_error": str(e)
                }

        # Mode is None (auto-detect): Use AI if API key is available
        if mode is None and has_api_key:
            try:
                answer = self.ask_llm(question, search_results)
                return {
                    "answer": answer,
                    "sources": search_results[:5] if search_results else [],
                    "mode": "full",
                    "has_llm_answer": True,
                    "search_message": "No relevant code found matching your query." if not search_results else None
                }
            except Exception as e:
                # If LLM fails, fall back to search only
                if not search_results:
                    return {
                        "answer": None,
                        "sources": [],
                        "mode": "search_only",
                        "has_llm_answer": False,
                        "llm_error": str(e),
                        "search_message": "No relevant code found matching your query. Try rephrasing or using different keywords."
                    }
                return {
                    "answer": None,
                    "sources": search_results[:5],
                    "mode": "search_only",
                    "has_llm_answer": False,
                    "llm_error": str(e)
                }

        # No API key or mode not specified - return search results only
        if not search_results:
            return {
                "answer": None,
                "sources": [],
                "mode": "search_only",
                "has_llm_answer": False,
                "search_message": "No relevant code found matching your query. Try rephrasing or using different keywords."
            }
        return {
            "answer": None,
            "sources": search_results[:5],
            "mode": "search_only",
            "has_llm_answer": False
        }
