'use strict';

// Search links make "reorder" one click even when no product URL is saved.
const VENDORS = [
  { name: 'Amazon', search: 'https://www.amazon.com/s?k=' },
  { name: 'Costco', search: 'https://www.costco.com/CatalogSearch?keyword=' },
  { name: 'Walmart', search: 'https://www.walmart.com/search?q=' },
  { name: 'Target', search: 'https://www.target.com/s?searchTerm=' },
  { name: 'Sam\'s Club', search: 'https://www.samsclub.com/s/' },
  { name: 'WebstaurantStore', search: 'https://www.webstaurantstore.com/search.html?searchval=' },
  { name: 'Staples', search: 'https://www.staples.com/search?query=' },
];

function buyUrl(item) {
  if (item.product_url) return item.product_url;
  const vendor = VENDORS.find((v) => v.name.toLowerCase() === (item.vendor || '').toLowerCase());
  const query = encodeURIComponent(item.name);
  return vendor ? vendor.search + query : `https://www.google.com/search?tbm=shop&q=${query}`;
}

module.exports = { VENDORS, buyUrl };
