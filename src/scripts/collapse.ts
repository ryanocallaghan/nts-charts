// Long lists show their first N items, with a button revealing N more at a time.
// Mark a list with data-collapse-list="10". Without JavaScript every item stays visible.
// A list with the "filtering" class (an active filter box) shows all matches and hides the button.
export function initCollapse(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>("[data-collapse-list]:not([data-collapse-ready])").forEach((list) => {
    list.dataset.collapseReady = "";
    const step = Number(list.dataset.collapseList) || 10;
    const items = [...list.children] as HTMLElement[];
    if (items.length <= step) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cds--btn cds--btn--ghost cds--btn--sm show-more";
    let shown = 0;
    const show = (n: number) => {
      shown = Math.min(n, items.length);
      items.forEach((li, i) => li.classList.toggle("collapsed-out", i >= shown));
      const all = shown >= items.length;
      const next = Math.min(step, items.length - shown);
      button.textContent = all ? "Show fewer" : `Show ${next} more (${shown + 1}–${shown + next} of ${items.length})`;
      button.setAttribute("aria-expanded", String(all));
    };
    button.addEventListener("click", () => {
      if (shown < items.length) return show(shown + step);
      show(step);
      if (list.getBoundingClientRect().top < 0) list.scrollIntoView({ block: "start" });
    });
    show(step);
    list.after(button);
  });
}

initCollapse();
