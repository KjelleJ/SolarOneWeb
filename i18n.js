(function(){
  const SUPPORTED = ['en','sv'];
  const KEY = 'solarone.lang';
  let current = 'en';
  let translations = {};

  function fetchJson(path) {
    return fetch(path).then((r)=>{
      if (!r.ok) throw new Error('Failed to load '+path);
      return r.json();
    });
  }

  async function loadTranslations(lang){
    if (!SUPPORTED.includes(lang)) lang = 'en';
    if (translations[lang]) {
      current = lang;
      return translations[lang];
    }
    const path = `./i18n/${lang}.json`;
    const data = await fetchJson(path);
    translations[lang] = data;
    current = lang;
    return data;
  }

  function lookup(key) {
    const parts = key.split('.');
    let node = translations[current] || {};
    for (const p of parts) {
      if (!node) return undefined;
      node = node[p];
    }
    return node;
  }

  function t(key, vars){
    const v = lookup(key);
    if (v === undefined) return key;
    if (typeof v === 'string') {
      if (!vars) return v;
      return v.replace(/\{([^}]+)\}/g, (_,name)=> (vars[name]!==undefined?vars[name] : ''));
    }
    return v;
  }

  function applyDomTranslations() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val === undefined) return;
      // preserve placeholder vs text decision
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        el.setAttribute('placeholder', val);
      } else {
        el.textContent = val;
      }
    });

    // attributes, format: data-i18n-attr="placeholder:title"
    document.querySelectorAll('[data-i18n-attr]').forEach((el) => {
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(',').forEach((pair) => {
        const [attr,key] = pair.split(':').map(s=>s.trim());
        if (!attr || !key) return;
        const val = t(key);
        if (val===undefined) return;
        el.setAttribute(attr, val);
      });
    });
  }

  function setDocumentLang(lang){
    try { document.documentElement.lang = lang; } catch(e){}
  }

  async function setLanguage(lang){
    await loadTranslations(lang);
    setDocumentLang(lang);
    try { localStorage.setItem(KEY, lang); } catch(e){}
    applyDomTranslations();
    // notify app code global object
    if (window.SolarOneI18n && typeof window.SolarOneI18n.onLanguageChanged === 'function') {
      window.SolarOneI18n.onLanguageChanged(lang);
    }
  }

  async function init(){
    const saved = (localStorage.getItem(KEY) || '').toLowerCase();
    const prefer = (saved && SUPPORTED.includes(saved)) ? saved : (navigator.language ? navigator.language.split('-')[0] : 'en');
    try {
      await loadTranslations(prefer);
    } catch (e) {
      await loadTranslations('en');
    }
    setDocumentLang(current);
    applyDomTranslations();
    // wire language-select if present
    const sel = document.getElementById('language-select');
    if (sel) {
      // populate options
      sel.innerHTML = '';
      const opts = [{v:'en',label:'English'},{v:'sv',label:'Svenska'}];
      opts.forEach((o)=>{
        const opt = document.createElement('option');
        opt.value = o.v;
        opt.textContent = o.label;
        if (o.v === current) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', async () => {
        await setLanguage(sel.value);
      });
    }

    return current;
  }

  // expose global
  window.SolarOneI18n = {
    init,
    setLanguage,
    t: (k,v) => t(k,v),
    current: () => current,
    onLanguageChanged: null
  };
})();
