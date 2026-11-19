// On phones, a pair of cards (Top 5 tracks and artists, climbers and new entries) shows one at a time,
// with a switch above them. Mark the container data-phone-tabs="<label>" and each card data-tab="<name>".
// The switch and the hiding only apply below 640px (global.css), so wider screens keep both side by side.
// Without JavaScript there's no switch and both cards show.

document.querySelectorAll<HTMLElement>("[data-phone-tabs]").forEach((group, g) => {
  const cards = [...group.querySelectorAll<HTMLElement>(":scope > [data-tab]")];
  if (cards.length < 2) return;
  const bar = document.createElement("div");
  bar.className = "cds--content-switcher cds--content-switcher--sm phone-tabs-bar";
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", group.dataset.phoneTabs || "Show");
  const buttons = cards.map((card, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cds--content-switcher-btn";
    b.innerHTML = '<span class="cds--content-switcher__label"></span>';
    b.querySelector("span")!.textContent = card.dataset.tab!;
    b.dataset.umamiEvent = "Home tab";
    b.dataset.umamiEventTab = card.dataset.tab!;
    card.id ||= `phone-tab-${g}-${i}`;
    b.setAttribute("aria-controls", card.id);
    b.addEventListener("click", () => select(i));
    return b;
  });
  function select(n: number) {
    cards.forEach((c, i) => c.classList.toggle("phone-tab-hidden", i !== n));
    buttons.forEach((b, i) => {
      b.classList.toggle("cds--content-switcher--selected", i === n);
      b.setAttribute("aria-pressed", String(i === n));
    });
  }
  bar.append(...buttons);
  group.before(bar);
  group.classList.add("phone-tabs-ready");
  select(0);
});
