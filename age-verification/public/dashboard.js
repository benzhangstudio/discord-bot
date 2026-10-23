document.querySelectorAll('#nav a').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const plugin = link.dataset.plugin;
    document.querySelectorAll('#nav a').forEach(a => a.classList.remove('active'));
    link.classList.add('active');
    document.querySelectorAll('.plugin').forEach(s => {
      s.hidden = s.id !== plugin;
      s.classList.toggle('active', s.id === plugin);
    });
    history.replaceState(null, '', '#' + plugin);
  });
});

const hash = location.hash.slice(1);
if (hash && document.getElementById(hash)) {
  document.querySelector(`[data-plugin="${hash}"]`)?.click();
}
