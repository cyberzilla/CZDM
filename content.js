(function() {
  const links = Array.from(document.querySelectorAll('a[href]'));
  const images = Array.from(document.querySelectorAll('img[src]'));
  const mediaElements = Array.from(document.querySelectorAll('video[src], audio[src], source[src]'));

  const results = [];
  const seen = new Set();
  const validExtensions = /\.(zip|rar|7z|tar|gz|iso|exe|msi|apk|mp4|mkv|avi|webm|mp3|wav|flac|ogg|jpg|jpeg|png|gif|webp|svg|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|bin|dat|dmg|pkg|deb|rpm)$/i;

  function addItem(url, type) {
    if (!url) return;
    try {
      const absUrl = new URL(url, document.baseURI).href;
      if (absUrl.startsWith('chrome:') || absUrl.startsWith('edge:') || absUrl.startsWith('about:') || absUrl.startsWith('blob:') || absUrl.startsWith('data:')) return;
      if (seen.has(absUrl)) return;

      const path = new URL(absUrl).pathname;
      if (type === 'link' && !validExtensions.test(path)) return;

      seen.add(absUrl);
      results.push({ url: absUrl, type: type });
    } catch (e) {}
  }

  links.forEach(a => addItem(a.href, 'link'));
  images.forEach(img => addItem(img.src, 'image'));
  mediaElements.forEach(m => addItem(m.src, 'media'));

  return results;
})();