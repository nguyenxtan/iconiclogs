const menu = document.querySelector('.mobile-menu');
const summary = menu?.querySelector('summary');
menu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menu.open = false;
  });
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && menu?.open) {
    menu.open = false;
    summary?.focus();
  }
});
document.addEventListener('click', (event) => {
  if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
    menu.open = false;
  }
});
