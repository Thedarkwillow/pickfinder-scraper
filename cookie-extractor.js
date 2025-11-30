/**
 * Cookie Extractor Helper Script
 * 
 * This script can be run in the browser console to help extract cookies
 * Run this in Chrome DevTools Console while logged into PickFinder
 */

(function() {
  console.log('🍪 Cookie Extractor Helper\n');
  console.log('Please select which cookies to export:\n');
  console.log('1. PickFinder cookies (pickfinder.app)');
  console.log('2. Google cookies (google.com)');
  console.log('3. All cookies\n');
  
  // Function to format cookies for our scraper
  function formatCookies(cookies, domain) {
    const now = Math.floor(Date.now() / 1000);
    const defaultExpiry = now + (30 * 24 * 60 * 60); // 30 days
    
    return cookies.map(cookie => {
      return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || domain,
        path: cookie.path || '/',
        expires: cookie.expires ? cookie.expires : defaultExpiry,
        httpOnly: cookie.httpOnly || false,
        secure: cookie.secure !== undefined ? cookie.secure : true,
        sameSite: cookie.sameSite || 'Lax'
      };
    });
  }
  
  // Function to export cookies
  async function exportCookies() {
    const cookies = document.cookie.split(';').reduce((acc, cookieStr) => {
      const [name, ...valueParts] = cookieStr.trim().split('=');
      const value = valueParts.join('=');
      
      if (name) {
        acc.push({
          name: name.trim(),
          value: value || '',
          domain: window.location.hostname,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
          httpOnly: false,
          secure: window.location.protocol === 'https:',
          sameSite: 'Lax'
        });
      }
      return acc;
    }, []);
    
    if (cookies.length === 0) {
      console.log('⚠️ No cookies found in document.cookie');
      console.log('💡 Tip: Use Chrome DevTools Application tab to export cookies manually');
      return null;
    }
    
    const formatted = formatCookies(cookies, window.location.hostname);
    return formatted;
  }
  
  // Export function
  window.exportPickFinderCookies = async function() {
    const cookies = await exportCookies();
    if (cookies) {
      console.log('\n✅ Cookies extracted!');
      console.log('\n📋 Copy the JSON below to your cookies.json file:\n');
      console.log(JSON.stringify(cookies, null, 2));
      console.log('\n💡 Tip: Right-click on the JSON output above and select "Copy object"');
    }
    return cookies;
  };
  
  console.log('💡 Run: exportPickFinderCookies() to extract cookies from current page');
  console.log('\n📝 Note: For complete cookie export including httpOnly cookies,');
  console.log('   use Chrome DevTools → Application tab → Cookies → Right-click → Copy');
})();

