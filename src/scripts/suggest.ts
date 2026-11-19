// Search suggestions for every form[data-suggest] (see HeaderSearch.astro): an ARIA combobox with a
// listbox of up to 8 results from /api/search.json, then "All results". Arrow keys move, Enter opens,
// Escape closes. Without a highlighted option, Enter submits the form to /search/ as normal.
interface Result { name: string; href: string; meta: string }

for (const form of document.querySelectorAll<HTMLFormElement>("form[data-suggest]")) {
  const input = form.querySelector<HTMLInputElement>("input[type=search]")!;
  const list = form.querySelector<HTMLUListElement>("[role=listbox]")!;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-expanded", "false");

  let active = -1;
  let seq = 0;
  let timer: number | undefined;
  const options = () => [...list.querySelectorAll<HTMLLIElement>("[role=option]")];

  function close() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function highlight(i: number) {
    const opts = options();
    if (!opts.length) return;
    active = (i + opts.length) % opts.length;
    opts.forEach((o, j) => o.setAttribute("aria-selected", String(j === active)));
    input.setAttribute("aria-activedescendant", opts[active].id);
    opts[active].scrollIntoView({ block: "nearest" });
  }

  function option(id: string, href: string, label: string, meta?: string) {
    const li = document.createElement("li");
    li.id = id;
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", "false");
    const a = document.createElement("a");
    a.href = href;
    a.tabIndex = -1;
    a.textContent = label;
    li.append(a);
    if (meta) {
      const span = document.createElement("span");
      span.className = "meta";
      span.textContent = meta;
      li.append(span);
    }
    return li;
  }

  async function suggest() {
    const mine = ++seq;
    const q = input.value.trim();
    if (q.length < 2) return close();
    try {
      const res = await fetch(`/api/search.json?limit=8&q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as { total: number; results: Result[] };
      if (mine !== seq) return;
      const items = data.results.map((r, i) => option(`${list.id}-${i}`, r.href, r.name, r.meta));
      const all = `/search/?q=${encodeURIComponent(q)}`;
      items.push(option(`${list.id}-all`, all, data.total ? `All ${data.total.toLocaleString("en-GB")} results` : "No matches · search page"));
      list.replaceChildren(...items);
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      active = -1;
    } catch {
      close();
    }
  }

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(suggest, 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (list.hidden) { suggest(); return; }
      e.preventDefault();
      highlight(active + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && !list.hidden && active >= 0) {
      e.preventDefault();
      location.href = options()[active].querySelector("a")!.href;
    } else if (e.key === "Escape" && !list.hidden) {
      e.preventDefault();
      close();
    }
  });
  // Close when focus or a click goes elsewhere (but not when clicking an option's link).
  form.addEventListener("focusout", (e) => { if (!form.contains(e.relatedTarget as Node | null)) setTimeout(close, 150); });
  document.addEventListener("click", (e) => { if (!form.contains(e.target as Node)) close(); });
}
