// NTS launched in 2011. A few episodes carry earlier, symbolic dates (e.g. "The NASA Golden Record",
// dated 4 Sep 1977 after Voyager's launch). Treat any date before this as unknown for charts, stats,
// "first played" and plays over time; the episodes still appear, with tracklists, on their show pages.
export const FIRST_VALID_DATE = "2011-01-01";

/** SQL: the episode (alias e) has a usable broadcast date. */
export const DATED = `e.broadcast_at >= '${FIRST_VALID_DATE}'`;
