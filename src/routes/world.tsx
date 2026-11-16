import { createFileRoute, redirect } from "@tanstack/react-router";

// Vecchio indirizzo: reindirizza alla nuova pagina.
export const Route = createFileRoute("/world")({
  beforeLoad: () => {
    throw redirect({ to: "/rassicurazioni-su-misura", replace: true });
  },
});
