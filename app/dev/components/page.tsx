import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input, Textarea } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";

export const metadata: Metadata = { title: "Components" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

/** Every UI component in each state, for checking both themes and keyboard use. Development only. */
export default function ComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-10 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Components</h1>
        <p className="mt-1 text-muted">Switch the theme in the header and Tab through the page to check focus rings.</p>
      </div>

      <Section title="Buttons">
        <Button>Search trips</Button>
        <Button variant="secondary">Edit request</Button>
        <Button variant="quiet">Show details</Button>
        <Button size="lg">Plan my trip</Button>
        <Button disabled>Searching…</Button>
      </Section>

      <Section title="Fields">
        <div className="w-full max-w-xl space-y-3">
          <Textarea aria-label="Trip request" placeholder="Where do you want to go, when, and what's your budget?" />
          <Input aria-label="Refine" placeholder="Cheaper hotel, no red-eyes…" />
          <Input aria-label="Disabled field" placeholder="Disabled" disabled />
        </div>
      </Section>

      <Section title="Chips">
        <Chip label="From" value="HNL" />
        <Chip label="To" value="Seattle" />
        <Chip label="Dates" value="Dec 11–15" />
        <Chip label="Travelers" value="2" />
        <Chip label="Budget" value="$1,600" />
      </Section>

      <Section title="Badges">
        <Badge>Sample data</Badge>
        <Badge tone="accent">Best match</Badge>
        <Badge tone="success">$669 under budget</Badge>
        <Badge tone="warning">Red-eye</Badge>
        <Badge tone="danger">$26 over budget</Badge>
      </Section>

      <Section title="Cards">
        <Card className="w-full max-w-sm">
          <p className="font-semibold">Static card</p>
          <p className="mt-1 text-sm text-muted">Text on a surface, with a muted second line.</p>
        </Card>
        <Card interactive className="w-full max-w-sm">
          <p className="font-semibold">Interactive card</p>
          <p className="mt-1 text-sm text-muted">Hover to see the raised state.</p>
        </Card>
      </Section>

      <Section title="Loading">
        <Card className="w-full max-w-xl space-y-3">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
      </Section>

      <Section title="Empty and error states">
        <EmptyState title="No trips yet" className="w-full max-w-xl" action={<Button variant="secondary">Start a search</Button>}>
          Describe where you want to go, when, and your budget.
        </EmptyState>
        <ErrorState title="Search stopped" className="w-full max-w-xl" action={<Button variant="secondary">Try again</Button>}>
          The flight search is unavailable right now. Your request was saved; try again in a minute.
        </ErrorState>
      </Section>
    </main>
  );
}
