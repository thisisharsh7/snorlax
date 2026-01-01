"""Test script to check GitHub rate limit access pattern."""

from github import Github
import os

# Initialize GitHub client
token = os.getenv("GITHUB_TOKEN")
if token:
    g = Github(token)
    print("Using authenticated GitHub client")
else:
    g = Github()
    print("Using unauthenticated GitHub client")

try:
    # Get rate limit
    rate_limit = g.get_rate_limit()

    print(f"\nRate limit object type: {type(rate_limit)}")
    print(f"Rate limit object: {rate_limit}")
    print(f"Dir: {dir(rate_limit)}")

    # Try different access patterns
    print("\n--- Trying different access patterns ---")

    # Pattern 1: .core
    try:
        core = rate_limit.core
        print(f"✓ rate_limit.core works: {core}")
        print(f"  Remaining: {core.remaining}")
        print(f"  Limit: {core.limit}")
        print(f"  Reset: {core.reset}")
    except AttributeError as e:
        print(f"✗ rate_limit.core failed: {e}")

    # Pattern 2: .rate
    try:
        rate = rate_limit.rate
        print(f"✓ rate_limit.rate works: {rate}")
        print(f"  Remaining: {rate.remaining}")
        print(f"  Limit: {rate.limit}")
        print(f"  Reset: {rate.reset}")
    except AttributeError as e:
        print(f"✗ rate_limit.rate failed: {e}")

    # Pattern 3: Direct attributes
    try:
        print(f"✓ Direct access works:")
        print(f"  Remaining: {rate_limit.remaining}")
        print(f"  Limit: {rate_limit.limit}")
        print(f"  Reset: {rate_limit.reset}")
    except AttributeError as e:
        print(f"✗ Direct access failed: {e}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
