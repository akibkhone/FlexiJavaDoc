import requests
from bs4 import BeautifulSoup
import json
import time
import re
from urllib.parse import urljoin, urlparse
from datetime import datetime
import logging

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class OracleAPIScrapingBot:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        self.discovered_apis = []
        self.visited_urls = set()
        self.base_domains = [
            'https://docs.oracle.com',
            'https://docs.cloud.oracle.com'
        ]
        
    def get_soup(self, url, timeout=10):
        """Get BeautifulSoup object for a URL with error handling"""
        try:
            response = self.session.get(url, timeout=timeout)
            response.raise_for_status()
            return BeautifulSoup(response.text, 'html.parser')
        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return None

    def discover_oracle_doc_entry_points(self):
        """Discover main Oracle documentation entry points"""
        entry_points = []
        
        # Main Oracle Cloud documentation index
        main_indexes = [
            'https://docs.oracle.com/en/cloud/',
            'https://docs.oracle.com/en/cloud/saas/',
            'https://docs.oracle.com/en/cloud/paas/',
            'https://docs.oracle.com/en/cloud/iaas/',
            'https://docs.cloud.oracle.com/en-us/iaas/api/',
        ]
        
        for index_url in main_indexes:
            logger.info(f"Discovering from main index: {index_url}")
            soup = self.get_soup(index_url)
            if soup:
                # Find all product/service links
                for link in soup.find_all('a', href=True):
                    href = link['href']
                    full_url = urljoin(index_url, href)
                    
                    # Look for product documentation links
                    if any(keyword in href.lower() for keyword in [
                        'supply-chain', 'scm', 'warehouse', 'wms', 'procurement',
                        'inventory', 'logistics', 'transportation', 'api', 'rest'
                    ]):
                        entry_points.append(full_url)
                        
                # Also look for direct API documentation links
                api_patterns = [
                    r'.*\/api\/.*',
                    r'.*\/rest.*',
                    r'.*rest-api.*',
                    r'.*\/swagger.*',
                    r'.*\/openapi.*'
                ]
                
                for link in soup.find_all('a', href=True):
                    href = link['href']
                    if any(re.match(pattern, href.lower()) for pattern in api_patterns):
                        entry_points.append(urljoin(index_url, href))
        
        return list(set(entry_points))

    def find_api_documentation_pages(self, base_url):
        """Find all API documentation pages from a base URL"""
        api_pages = []
        to_visit = [base_url]
        visited = set()
        
        while to_visit and len(visited) < 100:  # Limit to prevent infinite loops
            current_url = to_visit.pop(0)
            if current_url in visited:
                continue
                
            visited.add(current_url)
            logger.info(f"Scanning for API docs: {current_url}")
            
            soup = self.get_soup(current_url)
            if not soup:
                continue
                
            # Look for API-related links
            for link in soup.find_all('a', href=True):
                href = link['href']
                full_url = urljoin(current_url, href)
                
                # Skip external domains
                if not any(domain in full_url for domain in self.base_domains):
                    continue
                    
                link_text = link.get_text().lower()
                
                # Identify API documentation pages
                api_indicators = [
                    'rest api', 'api reference', 'api documentation',
                    'rest endpoints', 'web services', 'api guide',
                    '/op-', 'operation', 'endpoint'
                ]
                
                if any(indicator in link_text or indicator in href.lower() 
                       for indicator in api_indicators):
                    api_pages.append(full_url)
                    
                # Also add to visit queue if it looks like a product documentation page
                if (len(visited) < 50 and 
                    any(keyword in href.lower() for keyword in [
                        'guide', 'documentation', 'reference', 'api'
                    ]) and full_url not in visited):
                    to_visit.append(full_url)
            
            time.sleep(0.5)  # Be polite
            
        return list(set(api_pages))

    def extract_api_details(self, api_url):
        """Extract detailed API information from a documentation page"""
        soup = self.get_soup(api_url)
        if not soup:
            return None
            
        api_info = {
            'url': api_url,
            'title': '',
            'description': '',
            'method': '',
            'endpoint': '',
            'parameters': [],
            'response_format': '',
            'category': '',
            'version': '',
            'last_updated': ''
        }
        
        # Extract title
        title_selectors = ['h1', 'h2', '.title', '.topic-title']
        for selector in title_selectors:
            title_elem = soup.select_one(selector)
            if title_elem:
                api_info['title'] = title_elem.get_text(strip=True)
                break
                
        # Extract description
        desc_selectors = ['.shortdesc', '.topic', 'p', '.description']
        for selector in desc_selectors:
            desc_elem = soup.select_one(selector)
            if desc_elem:
                api_info['description'] = desc_elem.get_text(strip=True)[:500]
                break
                
        # Extract HTTP method and endpoint
        code_blocks = soup.find_all(['code', 'pre', '.codeph'])
        for code in code_blocks:
            text = code.get_text()
            # Look for HTTP method patterns
            method_match = re.search(r'\b(GET|POST|PUT|DELETE|PATCH)\s+([^\s]+)', text)
            if method_match:
                api_info['method'] = method_match.group(1)
                api_info['endpoint'] = method_match.group(2)
                break
                
        # Extract parameters from tables
        tables = soup.find_all('table')
        for table in tables:
            headers = [th.get_text(strip=True).lower() for th in table.find_all(['th', 'td'])]
            if any(param_indicator in ' '.join(headers) for param_indicator in ['parameter', 'field', 'attribute']):
                rows = table.find_all('tr')[1:]  # Skip header row
                for row in rows:
                    cells = [td.get_text(strip=True) for td in row.find_all(['td', 'th'])]
                    if len(cells) >= 2:
                        api_info['parameters'].append({
                            'name': cells[0],
                            'description': cells[1] if len(cells) > 1 else '',
                            'type': cells[2] if len(cells) > 2 else '',
                            'required': cells[3] if len(cells) > 3 else ''
                        })
                        
        # Try to determine category from URL
        url_parts = api_url.lower().split('/')
        category_keywords = {
            'supply-chain': 'Supply Chain Management',
            'scm': 'Supply Chain Management',
            'warehouse': 'Warehouse Management',
            'wms': 'Warehouse Management',
            'procurement': 'Procurement',
            'inventory': 'Inventory Management',
            'logistics': 'Logistics',
            'transportation': 'Transportation'
        }
        
        for keyword, category in category_keywords.items():
            if keyword in url_parts:
                api_info['category'] = category
                break
                
        # Extract version if available
        version_match = re.search(r'(\d+[a-z]?)', api_url)
        if version_match:
            api_info['version'] = version_match.group(1)
            
        return api_info

    def scrape_all_oracle_apis(self):
        """Main method to scrape all Oracle APIs"""
        logger.info("Starting comprehensive Oracle API documentation scraping...")
        
        # Step 1: Discover entry points
        entry_points = self.discover_oracle_doc_entry_points()
        logger.info(f"Found {len(entry_points)} entry points")
        
        # Step 2: Find all API documentation pages
        all_api_pages = []
        for entry_point in entry_points:
            api_pages = self.find_api_documentation_pages(entry_point)
            all_api_pages.extend(api_pages)
            time.sleep(1)  # Be respectful
            
        all_api_pages = list(set(all_api_pages))
        logger.info(f"Found {len(all_api_pages)} potential API documentation pages")
        
        # Step 3: Extract details from each API page
        for i, api_url in enumerate(all_api_pages):
            logger.info(f"Processing API {i+1}/{len(all_api_pages)}: {api_url}")
            
            api_details = self.extract_api_details(api_url)
            if api_details and (api_details['title'] or api_details['endpoint']):
                self.discovered_apis.append(api_details)
                
            time.sleep(0.5)  # Be polite
            
        logger.info(f"Successfully scraped {len(self.discovered_apis)} APIs")
        
    def save_results(self, filename='api-data.json'):
        """Save scraped API data to JSON file"""
        output_data = {
            'metadata': {
                'total_apis': len(self.discovered_apis),
                'scraped_at': datetime.now().isoformat(),
                'categories': list(set(api['category'] for api in self.discovered_apis if api['category']))
            },
            'apis': self.discovered_apis
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, indent=2, ensure_ascii=False)
            
        logger.info(f"Results saved to {filename}")
        
        # Also create a summary
        self.create_summary_report()
        
    def create_summary_report(self):
        """Create a summary report of discovered APIs"""
        categories = {}
        for api in self.discovered_apis:
            category = api['category'] or 'Uncategorized'
            if category not in categories:
                categories[category] = []
            categories[category].append(api)
            
        with open('oracle_api_summary.txt', 'w', encoding='utf-8') as f:
            f.write(f"Oracle API Discovery Summary\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Total APIs Found: {len(self.discovered_apis)}\n\n")
            
            for category, apis in categories.items():
                f.write(f"\n{category} ({len(apis)} APIs):\n")
                f.write("=" * (len(category) + 15) + "\n")
                for api in apis:
                    f.write(f"  • {api['title'] or 'Untitled'}\n")
                    if api['method'] and api['endpoint']:
                        f.write(f"    {api['method']} {api['endpoint']}\n")
                    f.write(f"    URL: {api['url']}\n\n")

def main():
    """Main execution function"""
    scraper = OracleAPIScrapingBot()
    
    try:
        scraper.scrape_all_oracle_apis()
        scraper.save_results()
        
        print(f"\n🎉 Scraping completed successfully!")
        print(f"📊 Total APIs discovered: {len(scraper.discovered_apis)}")
        print(f"💾 Results saved to: api-data.json")
        print(f"📋 Summary report: oracle_api_summary.txt")
        
    except KeyboardInterrupt:
        print("\n⚠️ Scraping interrupted by user")
        if scraper.discovered_apis:
            scraper.save_results()
            print(f"💾 Partial results saved: {len(scraper.discovered_apis)} APIs")
            
    except Exception as e:
        logger.error(f"❌ Scraping failed: {e}")
        if scraper.discovered_apis:
            scraper.save_results()
            print(f"💾 Partial results saved: {len(scraper.discovered_apis)} APIs")

if __name__ == "__main__":
    main()
