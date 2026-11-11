import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Pagina bianca" },
      { name: "description", content: "Una semplice pagina bianca." },
      { property: "og:title", content: "Pagina bianca" },
      { property: "og:description", content: "Una semplice pagina bianca." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return <div className="min-h-screen bg-background" />;
}
