(function() {
  const links = Array.from(document.querySelectorAll('a[href]'));
  const images = Array.from(document.querySelectorAll('img[src]'));
  
  const results = [];
  const seen = new Set();
  const validExtensions = /\.(zip|rar|7z|tar|gz|iso|exe|msi|apk|mp4|mkv|avi|webm|mp3|wav|flac|ogg|jpg|jpeg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|bin|dat|dmg|pkg|deb|rpm)$/i;

  function addItem(url, text, type) {
    if (!url) return;
    try {
      const absUrl = new URL(url, document.baseURI).href;
      if (absUrl.startsWith('chrome:') || absUrl.startsWith('edge:') || absUrl.startsWith('about:')) return;
      if (seen.has(absUrl)) return;
      
      const path = new URL(absUrl).pathname;
      if (type === 'link' && !validExtensions.test(path)) return;

      seen.add(absUrl);
      let filename = absUrl.substring(absUrl.lastIndexOf('/') + 1).split('?')[0];
      if (!filename || filename.trim() === '') filename = 'unknown';
      let cleanText = (text || '').trim();
      if (!cleanText) cleanText = filename;

      results.push({ url: absUrl, text: cleanText, type: type });
    } catch (e) {}
  }

  links.forEach(a => addItem(a.href, a.innerText, 'link'));
  images.forEach(img => addItem(img.src, img.alt || 'Image', 'image'));
  
  return results;
})();