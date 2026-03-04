/* ===== back-to-top ===== */
// /js/back-to-top.js
(() => {
  if (document.getElementById("backToTop")) return;

  const btn = document.createElement("button");
  btn.id = "backToTop";
  btn.type = "button";
  btn.setAttribute("aria-label", "ページ上部へ戻る");
  btn.innerHTML = `
<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M12 4l-7 7 1.4 1.4L11 7.8V20h2V7.8l4.6 4.6L19 11z" fill="currentColor"></path>
</svg>
`;

  document.body.appendChild(btn);

  const SHOW_AFTER_PX = 240;
  const HIDE_NEAR_BOTTOM_PX = 180;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  const update = () => {
    const y = window.scrollY || document.documentElement.scrollTop || 0;

    const doc = document.documentElement;
    const maxY = doc.scrollHeight - window.innerHeight;
    const distToBottom = maxY - y;

    const shouldShow = y > SHOW_AFTER_PX;
    const shouldHideNearBottom = distToBottom < HIDE_NEAR_BOTTOM_PX;

    btn.classList.toggle("is-visible", shouldShow && !shouldHideNearBottom);
    btn.classList.toggle("is-hidden-near-bottom", shouldHideNearBottom);
  };

  btn.addEventListener("click", () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  });

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      update();
      ticking = false;
    });
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", update, { passive: true });

  update();
})();