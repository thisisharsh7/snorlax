"""
Service for generating and managing embeddings for GitHub issues and PRs using CocoIndex.
Ensures consistency with code embeddings by using the same embedding function.
"""

import os
import sys
from typing import List, Dict, Optional
from psycopg_pool import ConnectionPool
from pgvector.psycopg import register_vector

# Import CocoIndex's shared embedding function for consistency
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from flows import code_to_embedding


class IssueEmbeddingService:
    """
    Service for generating and managing embeddings for issues and PRs.
    Uses CocoIndex's code_to_embedding for consistency with code embeddings.
    """

    def __init__(self):
        """Initialize service with database connection pool."""
        self.db_pool = ConnectionPool(os.getenv("APP_DATABASE_URL"))

    def _combine_text(self, title: str, body: Optional[str]) -> str:
        """Combine title and body for embedding."""
        if body:
            return f"{title}\n\n{body}"
        return title

    def generate_issue_embedding(self, project_id: str, issue_number: int) -> bool:
        """
        Generate embedding for a single issue using CocoIndex.

        Args:
            project_id: Project identifier
            issue_number: Issue number

        Returns:
            True if successful
        """
        # Retry logic for stale connections
        for attempt in range(2):
            try:
                with self.db_pool.connection() as conn:
                    register_vector(conn)
                    with conn.cursor() as cur:
                        # Fetch issue data
                        cur.execute("""
                            SELECT title, body
                            FROM github_issues
                            WHERE project_id = %s AND issue_number = %s
                        """, (project_id, issue_number))

                        result = cur.fetchone()
                        if not result:
                            return False

                        title, body = result
                        text = self._combine_text(title, body)

                        # Generate embedding using CocoIndex's transform flow
                        # This ensures consistency with code embeddings
                        embedding = code_to_embedding.eval(text)

                        # Store in issue_embeddings table
                        cur.execute("""
                            INSERT INTO issue_embeddings
                                (project_id, issue_number, type, embedding)
                            VALUES (%s, %s, 'issue', %s)
                            ON CONFLICT (project_id, type, issue_number)
                            DO UPDATE SET
                                embedding = EXCLUDED.embedding,
                                updated_at = NOW()
                        """, (project_id, issue_number, embedding))

                        conn.commit()
                        return True
            except Exception as e:
                if attempt == 0 and "closed" in str(e).lower():
                    # Connection was stale, retry once
                    print(f"Retrying due to stale connection: {e}")
                    continue
                else:
                    # Real error or second attempt failed
                    raise
        return False

    def generate_pr_embedding(self, project_id: str, pr_number: int) -> bool:
        """
        Generate embedding for a single PR using CocoIndex.

        Args:
            project_id: Project identifier
            pr_number: PR number

        Returns:
            True if successful
        """
        # Retry logic for stale connections
        for attempt in range(2):
            try:
                with self.db_pool.connection() as conn:
                    register_vector(conn)
                    with conn.cursor() as cur:
                        # Fetch PR data
                        cur.execute("""
                            SELECT title, body
                            FROM github_pull_requests
                            WHERE project_id = %s AND pr_number = %s
                        """, (project_id, pr_number))

                        result = cur.fetchone()
                        if not result:
                            return False

                        title, body = result
                        text = self._combine_text(title, body)

                        # Generate embedding using CocoIndex
                        embedding = code_to_embedding.eval(text)

                        # Store in issue_embeddings table (type='pr')
                        cur.execute("""
                            INSERT INTO issue_embeddings
                                (project_id, pr_number, type, embedding)
                            VALUES (%s, %s, 'pr', %s)
                            ON CONFLICT (project_id, type, pr_number)
                            DO UPDATE SET
                                embedding = EXCLUDED.embedding,
                                updated_at = NOW()
                        """, (project_id, pr_number, embedding))

                        conn.commit()
                        return True
            except Exception as e:
                if attempt == 0 and "closed" in str(e).lower():
                    # Connection was stale, retry once
                    print(f"Retrying due to stale connection: {e}")
                    continue
                else:
                    # Real error or second attempt failed
                    raise
        return False

    def generate_all_embeddings(self, project_id: str) -> Dict[str, int]:
        """
        Generate embeddings for all issues and PRs in a project.

        Args:
            project_id: Project identifier

        Returns:
            Statistics dictionary with counts
        """
        issues_count = 0
        prs_count = 0

        with self.db_pool.connection() as conn:
            with conn.cursor() as cur:
                # Get all issues
                cur.execute("""
                    SELECT issue_number
                    FROM github_issues
                    WHERE project_id = %s
                    ORDER BY issue_number
                """, (project_id,))
                issue_numbers = [row[0] for row in cur.fetchall()]

                # Get all PRs
                cur.execute("""
                    SELECT pr_number
                    FROM github_pull_requests
                    WHERE project_id = %s
                    ORDER BY pr_number
                """, (project_id,))
                pr_numbers = [row[0] for row in cur.fetchall()]

        # Generate embeddings
        for issue_number in issue_numbers:
            if self.generate_issue_embedding(project_id, issue_number):
                issues_count += 1

        for pr_number in pr_numbers:
            if self.generate_pr_embedding(project_id, pr_number):
                prs_count += 1

        return {
            "issues_embedded": issues_count,
            "prs_embedded": prs_count,
            "total": issues_count + prs_count
        }

    def search_similar_issues(
        self,
        project_id: str,
        issue_number: int,
        limit: int = 10,
        min_similarity: float = 0.0
    ) -> List[Dict]:
        """
        Find similar issues using vector similarity search.

        Args:
            project_id: Project identifier
            issue_number: Issue to find similarities for
            limit: Maximum number of results
            min_similarity: Minimum similarity threshold (0.0 to 1.0)

        Returns:
            List of similar issues with similarity scores
        """
        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Get the embedding for the target issue
                cur.execute("""
                    SELECT embedding
                    FROM issue_embeddings
                    WHERE project_id = %s
                      AND type = 'issue'
                      AND issue_number = %s
                """, (project_id, issue_number))

                result = cur.fetchone()
                if not result:
                    return []

                embedding = result[0]

                # Find similar issues using cosine similarity
                cur.execute("""
                    SELECT
                        ie.issue_number,
                        gi.title,
                        gi.state,
                        gi.github_url,
                        1 - (ie.embedding <=> %s) AS similarity
                    FROM issue_embeddings ie
                    JOIN github_issues gi
                        ON ie.project_id = gi.project_id
                        AND ie.issue_number = gi.issue_number
                    WHERE ie.project_id = %s
                      AND ie.type = 'issue'
                      AND ie.issue_number != %s
                      AND 1 - (ie.embedding <=> %s) >= %s
                    ORDER BY ie.embedding <=> %s
                    LIMIT %s
                """, (embedding, project_id, issue_number, embedding, min_similarity, embedding, limit))

                results = cur.fetchall()

                return [
                    {
                        "issue_number": row[0],
                        "title": row[1],
                        "state": row[2],
                        "github_url": row[3],
                        "similarity": round(row[4], 3)
                    }
                    for row in results
                ]

    def search_similar_prs(
        self,
        project_id: str,
        issue_number: int,
        limit: int = 10,
        min_similarity: float = 0.0
    ) -> List[Dict]:
        """
        Find PRs similar to an issue.

        Args:
            project_id: Project identifier
            issue_number: Issue to find similar PRs for
            limit: Maximum number of results
            min_similarity: Minimum similarity threshold

        Returns:
            List of similar PRs with similarity scores
        """
        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Get the embedding for the issue
                cur.execute("""
                    SELECT embedding
                    FROM issue_embeddings
                    WHERE project_id = %s
                      AND type = 'issue'
                      AND issue_number = %s
                """, (project_id, issue_number))

                result = cur.fetchone()
                if not result:
                    return []

                embedding = result[0]

                # Find similar PRs
                cur.execute("""
                    SELECT
                        ie.pr_number,
                        gpr.title,
                        gpr.state,
                        gpr.github_url,
                        1 - (ie.embedding <=> %s) AS similarity
                    FROM issue_embeddings ie
                    JOIN github_pull_requests gpr
                        ON ie.project_id = gpr.project_id
                        AND ie.pr_number = gpr.pr_number
                    WHERE ie.project_id = %s
                      AND ie.type = 'pr'
                      AND 1 - (ie.embedding <=> %s) >= %s
                    ORDER BY ie.embedding <=> %s
                    LIMIT %s
                """, (embedding, project_id, embedding, min_similarity, embedding, limit))

                results = cur.fetchall()

                return [
                    {
                        "pr_number": row[0],
                        "title": row[1],
                        "state": row[2],
                        "github_url": row[3],
                        "similarity": round(row[4], 3)
                    }
                    for row in results
                ]

    def search_in_codebase(
        self,
        project_id: str,
        issue_number: int,
        limit: int = 10,
        min_similarity: float = 0.0
    ) -> List[Dict]:
        """
        Search for code that might already implement the issue.
        Uses same embedding space as code and issues for comparison.

        Args:
            project_id: Project identifier
            issue_number: Issue to search for in codebase
            limit: Maximum number of results
            min_similarity: Minimum similarity threshold

        Returns:
            List of similar code chunks with similarity scores
        """
        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Get the embedding for the issue
                cur.execute("""
                    SELECT embedding
                    FROM issue_embeddings
                    WHERE project_id = %s
                      AND type = 'issue'
                      AND issue_number = %s
                """, (project_id, issue_number))

                result = cur.fetchone()
                if not result:
                    return []

                embedding = result[0]
                table_name = f"embeddings_{project_id.replace('-', '_')}"

                # Search in code embeddings table
                try:
                    cur.execute(f"""
                        SELECT
                            filename,
                            code,
                            language,
                            start_line,
                            end_line,
                            1 - (embedding <=> %s) AS similarity
                        FROM {table_name}
                        WHERE 1 - (embedding <=> %s) >= %s
                        ORDER BY embedding <=> %s
                        LIMIT %s
                    """, (embedding, embedding, min_similarity, embedding, limit))

                    results = cur.fetchall()

                    return [
                        {
                            "filename": row[0],
                            "code": row[1],
                            "language": row[2],
                            "start_line": row[3],
                            "end_line": row[4],
                            "similarity": round(row[5], 3)
                        }
                        for row in results
                    ]
                except Exception as e:
                    print(f"Error searching codebase: {e}")
                    return []

    def generate_query_embedding(self, query_text: str) -> Optional[List[float]]:
        """
        Generate 384-dimensional embedding for search query using CocoIndex.

        Args:
            query_text: Natural language query text

        Returns:
            Embedding vector or None if generation fails
        """
        try:
            embedding = code_to_embedding.eval(query_text)
            return embedding
        except Exception as e:
            print(f"Error generating query embedding: {e}")
            return None

    def search_by_text(
        self,
        project_id: str,
        query_text: str,
        limit: int = 20,
        min_similarity: float = 0.3,
        category_filter: Optional[str] = None
    ) -> List[Dict]:
        """
        Search issues by text query using cosine similarity.

        Args:
            project_id: Project identifier
            query_text: Natural language search query
            limit: Maximum number of results (default 20)
            min_similarity: Minimum similarity threshold 0.0-1.0 (default 0.3)
            category_filter: Optional category to filter by (critical|bug|feature_request|question|low_priority)

        Returns:
            List of issues with similarity scores (0-1)
        """
        # Generate embedding for query
        query_embedding = self.generate_query_embedding(query_text)
        if query_embedding is None:
            return []

        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Build query with optional category filter
                if category_filter:
                    sql = """
                        SELECT
                            ie.issue_number,
                            gi.title,
                            gi.body,
                            gi.state,
                            gi.github_url,
                            1 - (ie.embedding <=> %s) AS similarity
                        FROM issue_embeddings ie
                        JOIN github_issues gi
                            ON ie.project_id = gi.project_id
                            AND ie.issue_number = gi.issue_number
                        LEFT JOIN issue_categories ic
                            ON ie.project_id = ic.project_id
                            AND ie.issue_number = ic.issue_number
                        WHERE ie.project_id = %s
                          AND ie.type = 'issue'
                          AND gi.state = 'open'
                          AND ic.category = %s
                          AND 1 - (ie.embedding <=> %s) >= %s
                        ORDER BY ie.embedding <=> %s
                        LIMIT %s
                    """
                    cur.execute(sql, (
                        query_embedding, project_id, category_filter,
                        query_embedding, min_similarity, query_embedding, limit
                    ))
                else:
                    sql = """
                        SELECT
                            ie.issue_number,
                            gi.title,
                            gi.body,
                            gi.state,
                            gi.github_url,
                            1 - (ie.embedding <=> %s) AS similarity
                        FROM issue_embeddings ie
                        JOIN github_issues gi
                            ON ie.project_id = gi.project_id
                            AND ie.issue_number = gi.issue_number
                        WHERE ie.project_id = %s
                          AND ie.type = 'issue'
                          AND gi.state = 'open'
                          AND 1 - (ie.embedding <=> %s) >= %s
                        ORDER BY ie.embedding <=> %s
                        LIMIT %s
                    """
                    cur.execute(sql, (
                        query_embedding, project_id,
                        query_embedding, min_similarity, query_embedding, limit
                    ))

                results = cur.fetchall()

                return [
                    {
                        "issue_number": row[0],
                        "title": row[1],
                        "body": row[2],
                        "state": row[3],
                        "github_url": row[4],
                        "similarity": round(row[5], 3)
                    }
                    for row in results
                ]

    def search_by_text_simple(
        self,
        project_id: str,
        query_text: str,
        limit: int = 20,
        category_filter: Optional[str] = None
    ) -> List[Dict]:
        """
        Simple text search fallback using SQL ILIKE pattern matching.
        Searches through issue titles and bodies when semantic search fails or returns no results.

        Args:
            project_id: Project identifier
            query_text: Search query text
            limit: Maximum number of results (default 20)
            category_filter: Optional category to filter by

        Returns:
            List of issues matching the text query
        """
        with self.db_pool.connection() as conn:
            register_vector(conn)
            with conn.cursor() as cur:
                # Create search pattern for ILIKE
                search_pattern = f"%{query_text}%"

                if category_filter:
                    sql = """
                        SELECT DISTINCT
                            gi.issue_number,
                            gi.title,
                            gi.body,
                            gi.state,
                            gi.github_url
                        FROM github_issues gi
                        LEFT JOIN issue_categories ic
                            ON gi.project_id = ic.project_id
                            AND gi.issue_number = ic.issue_number
                        WHERE gi.project_id = %s
                          AND gi.state = 'open'
                          AND ic.category = %s
                          AND (gi.title ILIKE %s OR gi.body ILIKE %s)
                        ORDER BY gi.created_at DESC
                        LIMIT %s
                    """
                    cur.execute(sql, (
                        project_id, category_filter,
                        search_pattern, search_pattern, limit
                    ))
                else:
                    sql = """
                        SELECT
                            gi.issue_number,
                            gi.title,
                            gi.body,
                            gi.state,
                            gi.github_url
                        FROM github_issues gi
                        WHERE gi.project_id = %s
                          AND gi.state = 'open'
                          AND (gi.title ILIKE %s OR gi.body ILIKE %s)
                        ORDER BY gi.created_at DESC
                        LIMIT %s
                    """
                    cur.execute(sql, (
                        project_id, search_pattern, search_pattern, limit
                    ))

                results = cur.fetchall()

                return [
                    {
                        "issue_number": row[0],
                        "title": row[1],
                        "body": row[2],
                        "state": row[3],
                        "github_url": row[4],
                        "similarity": None  # No similarity score for text search
                    }
                    for row in results
                ]
