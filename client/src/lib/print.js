/**
 * Prints only a specific DOM subtree cleanly — no sidebar, nav, or other page
 * chrome — with a minimal "company name" header and "developer name" footer
 * injected for the duration of the print only.
 *
 * Usage:
 *   <div id="my-print-area"> ...content to print... </div>
 *   <button onClick={() => printSection("my-print-area")}>Print</button>
 */
export function printSection(sectionId) {
  const el = document.getElementById(sectionId);
  if (!el) {
    window.print();
    return;
  }
  document.querySelectorAll(".print-scope-target").forEach((n) => n.classList.remove("print-scope-target"));
  el.classList.add("print-scope-target");
  document.body.classList.add("print-scoped");

  const cleanup = () => {
    document.body.classList.remove("print-scoped");
    el.classList.remove("print-scope-target");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);

  // Give the browser a tick to apply the class before invoking print.
  requestAnimationFrame(() => window.print());
}
