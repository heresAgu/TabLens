(function () {
  const key = 'tablens.theme.v1';
  const choices = ['system', 'light', 'dark'];
  const names = {system: '跟随系统', light: '浅色', dark: '深色'};
  const icons = {system: '◐', light: '☀', dark: '☾'};
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';

  try {
    const stored = window.localStorage.getItem(key);
    if (choices.includes(stored)) preference = stored;
  } catch (_) {
    // Browsers with disabled storage can still switch themes for this session.
  }

  function apply() {
    const effective = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.themePreference = preference;
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const next = choices[(choices.indexOf(preference) + 1) % choices.length];
    button.textContent = `${icons[preference]} ${names[preference]}`;
    button.setAttribute('aria-label', `主题：${names[preference]}，点击切换为${names[next]}`);
    button.title = `当前：${names[preference]}；点击切换为${names[next]}`;
  }

  media.addEventListener('change', () => {
    if (preference === 'system') apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.getElementById('theme-toggle').addEventListener('click', () => {
      preference = choices[(choices.indexOf(preference) + 1) % choices.length];
      try { window.localStorage.setItem(key, preference); } catch (_) { /* Session-only choice. */ }
      apply();
    });
  });
  apply();
})();
