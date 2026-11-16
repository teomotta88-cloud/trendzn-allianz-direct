import { createFileRoute, redirect } from "@tanstack/react-router";

// Vecchio indirizzo: reindirizza alla nuova pagina.
export const Route = createFileRoute("/taste")({
  beforeLoad: () => {
    throw redirect({ to: "/prodotti-direct", replace: true });
  },
});
