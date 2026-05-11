// Shared back-to-hub button. Each checkpoint's index.html should include:
//   <script src="../back-to-hub.js"></script>
//
// The script injects a fixed button in the bottom-left that links back to the
// hub at the repo root. Path is relative so the checkpoint also works when
// served from a sub-path on a static host.

(function () {
  if (window.__backToHubInstalled) return;
  window.__backToHubInstalled = true;

  const HUB_HREF = '../../index.html';

  function install() {
    const btn = document.createElement('a');
    btn.href = HUB_HREF;
    btn.textContent = '← Hub';
    btn.setAttribute('aria-label', 'Back to version hub');
    Object.assign(btn.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: '2147483647',
      padding: '8px 14px',
      background: 'rgba(13, 20, 16, 0.78)',
      color: '#7cd29a',
      border: '1px solid #2a3a32',
      borderRadius: '6px',
      textDecoration: 'none',
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '13px',
      lineHeight: '1',
      pointerEvents: 'auto',
      userSelect: 'none',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      transition: 'border-color .15s ease, color .15s ease',
    });
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#7cd29a'; });
    btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#2a3a32'; });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
