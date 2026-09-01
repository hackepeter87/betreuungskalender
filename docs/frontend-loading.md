# Frontend loading and offline behavior

The initial application bundle contains the dashboard and first-use setup. The
remaining pages load only when they are opened. They share one accessible
loading state and one generic failure state with an explicit reload action.

Report, analytics, and PDF generation dependencies stay outside the initial
bundle. The production build writes a Vite manifest and fails when a JavaScript
chunk exceeds 500 kB, when report or analytics code becomes eager, or when PDF
dependencies enter the initial import graph.

The service worker caches hashed frontend assets after they have been loaded.
This means a previously opened deferred page can be available from the
installed application cache. A page that has never been downloaded still
requires a network connection. API requests remain network-only, and offline
use remains read-only.

When a deferred asset cannot be loaded, the browser retains that failed module
URL for the current document. The failure state therefore offers an explicit
application reload instead of presenting an in-place retry that cannot recover
reliably.
