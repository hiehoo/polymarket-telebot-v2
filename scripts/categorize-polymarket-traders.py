#!/usr/bin/env python3
"""
Categorize traders by market category (Sports, Politics, Crypto, etc.)
Fetches performance data for each category and groups traders.
"""

import requests
import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

API_URL = 'https://polymarketanalytics.com/api/traders-tag-performance'

# Main categories to fetch
CATEGORIES = [
    'Sports',
    'Politics',
    'Crypto',
    'Soccer',
    'Basketball',
    'NFL',
    'Tennis',
    'Trump',
    'Elections',
    'Bitcoin',
    'Ethereum',
]


def fetch_traders_by_category(category: str, limit: int = 100) -> list:
    """Fetch top N traders for a specific category (no filters, sorted by PnL)."""
    try:
        response = requests.post(
            API_URL,
            headers={'Content-Type': 'application/json'},
            json={
                'tag': category,
                'page': 1,
                'pageSize': limit,
                'sortBy': 'pnl',
                'sortDirection': 'desc'
            },
            timeout=30
        )
        response.raise_for_status()
        return response.json().get('data', [])
    except requests.RequestException as e:
        print(f"  Error: {e}")
        return []


def main():
    print("Categorizing traders by market category (Top 100 per category)")
    print("=" * 60)

    categorized = {}

    for category in CATEGORIES:
        print(f"Fetching [{category}]...", end=" ", flush=True)
        traders = fetch_traders_by_category(category, limit=100)
        categorized[category] = traders
        print(f"{len(traders)} traders")

    # Save categorized data
    output_path = Path(__file__).parent / 'traders-by-category.json'
    with open(output_path, 'w') as f:
        json.dump(categorized, f, indent=2)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for category, traders in sorted(categorized.items(), key=lambda x: -len(x[1])):
        if traders:
            top = traders[0]
            print(f"\n{category}: {len(traders)} traders")
            print(f"  Top: {top['trader_name']} | PnL: ${top['overall_gain']:,.2f} | WR: {top['win_rate']*100:.1f}%")

    print(f"\nSaved to: {output_path}")

    # Also create a simple lookup by trader address
    trader_categories = {}
    for category, traders in categorized.items():
        for t in traders:
            addr = t['trader']
            if addr not in trader_categories:
                trader_categories[addr] = {
                    'trader_name': t['trader_name'],
                    'categories': {}
                }
            trader_categories[addr]['categories'][category] = {
                'pnl': t['overall_gain'],
                'win_rate': t['win_rate'],
                'positions': t['total_positions'],
                'rank': t.get('rank')
            }

    # Save trader lookup
    lookup_path = Path(__file__).parent / 'traders-category-lookup.json'
    with open(lookup_path, 'w') as f:
        json.dump(trader_categories, f, indent=2)

    print(f"Lookup saved to: {lookup_path}")
    print(f"Unique traders across categories: {len(trader_categories)}")


if __name__ == '__main__':
    main()
