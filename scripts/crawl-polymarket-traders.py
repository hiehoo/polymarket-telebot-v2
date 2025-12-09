#!/usr/bin/env python3
"""
Crawl traders from Polymarket Analytics with filters.
Filters: win_rate > 67%, total_positions > 30
"""

import requests
import json
import time
from pathlib import Path

API_URL = 'https://polymarketanalytics.com/api/traders-tag-performance'

def crawl_traders(min_win_rate: int = 67, min_positions: int = 30, page_size: int = 100) -> list:
    """
    Crawl all traders matching the filter criteria.

    Args:
        min_win_rate: Minimum win rate percentage (default: 67)
        min_positions: Minimum total positions (default: 30)
        page_size: Number of traders per page (default: 100)

    Returns:
        List of trader objects
    """
    all_traders = []
    page = 1

    print(f"Crawling traders with filters: win_rate >= {min_win_rate}%, positions >= {min_positions}")
    print("-" * 60)

    while True:
        try:
            response = requests.post(
                API_URL,
                headers={'Content-Type': 'application/json'},
                json={
                    'tag': 'Overall',
                    'page': page,
                    'pageSize': page_size,
                    'sortBy': 'pnl',
                    'sortDirection': 'desc',
                    'minWinRate': min_win_rate,
                    'minTotalPositions': min_positions
                },
                timeout=30
            )
            response.raise_for_status()

            data = response.json()
            traders = data.get('data', [])

            if not traders:
                break

            all_traders.extend(traders)
            print(f"Page {page}: {len(traders)} traders (Total: {len(all_traders)})")

            # Check if we've reached the end
            if len(traders) < page_size:
                break

            page += 1
            time.sleep(0.5)  # Rate limiting

        except requests.RequestException as e:
            print(f"Error on page {page}: {e}")
            break

    return all_traders


def main():
    # Crawl traders
    traders = crawl_traders(min_win_rate=67, min_positions=30)

    if not traders:
        print("No traders found matching criteria.")
        return

    # Save to JSON
    output_path = Path(__file__).parent / 'traders.json'
    with open(output_path, 'w') as f:
        json.dump(traders, f, indent=2)

    print("-" * 60)
    print(f"Total traders: {len(traders)}")
    print(f"Saved to: {output_path}")

    # Print top 5 traders summary
    print("\nTop 5 Traders by PnL:")
    print("-" * 60)
    for i, t in enumerate(traders[:5], 1):
        print(f"{i}. {t['trader_name']} ({t['trader'][:10]}...)")
        print(f"   PnL: ${t['overall_gain']:,.2f} | Win Rate: {t['win_rate']*100:.1f}% | Positions: {t['total_positions']}")


if __name__ == '__main__':
    main()
