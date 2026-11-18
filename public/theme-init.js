(function () {
  try {
    var saved = localStorage.getItem('yume:theme');
    var theme = saved === 'day' || saved === 'night' ? saved : 'night';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === 'day' ? 'light' : 'dark';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'day' ? '#fbf6fa' : '#09070e');
  } catch (error) {
    document.documentElement.dataset.theme = 'night';
  }
})();
