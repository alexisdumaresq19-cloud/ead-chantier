import type { UseQueryResult } from "@tanstack/react-query";
import { ChevronDown, History, Minus, Plus, UserMinus, UserPlus } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";

import type { Member } from "@/shared/api";
import { isValidHours, REPORT_LIMITS, type CrewLine } from "@/shared/reports";

import { cn } from "../../lib/cn";
import { count } from "../../lib/format";
import { Avatar, Button, IconButton, Input, Sheet, Skeleton, toast } from "../../ui";
import {
  addBlankRow,
  addMember,
  membersToAdd,
  removeRow,
  setDayHours,
  setRowHours,
  setRowName,
  stepDayHours,
  stepRowHours,
  takeCrew,
  type CrewRow,
  type FormProblem,
  type ReportForm,
} from "./form";
import { formatHours, hoursText, parseHours, previousCrewLabel } from "./lib";

// The crew of the day: one line per person, a name and hours. The people of
// the project are added in one tap, the hours of the day are set once for
// everyone, and yesterday's crew can be taken over as it was. One person's
// hours change in a window of taps, with no keyboard; removing someone is
// done there too, away from the thumb's path.

export function CrewEditor({
  form,
  setForm,
  problems,
  members,
  previous,
  today,
}: {
  form: ReportForm;
  setForm: Dispatch<SetStateAction<ReportForm>>;
  problems: FormProblem[];
  members: UseQueryResult<Member[]>;
  /** The crew of the last report before this day, if there is one. */
  previous: { day: string; crew: CrewLine[] } | null;
  today: string;
}) {
  // The line just added by hand: its name field takes the keyboard.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  // The line whose hours are being changed, in the window.
  const [editing, setEditing] = useState<string | null>(null);
  const editedRow = form.crew.find((row) => row.key === editing) ?? null;
  const full = form.crew.length >= REPORT_LIMITS.crew;
  const toAdd = membersToAdd(form, members.data ?? []);

  const takePrevious = () => {
    if (!previous) return;
    const { form: next, added } = takeCrew(form, previous.crew);
    setForm(next);
    if (added > 0) toast.success(count(added, "personne ajoutée", "personnes ajoutées"));
    else toast("Toute cette équipe est déjà inscrite.");
  };
  const addName = () => {
    const { form: next, key } = addBlankRow(form);
    setForm(next);
    setJustAdded(key);
  };

  return (
    <div>
      <div className="bg-canvas rounded-xl py-1.5 pr-1.5 pl-3.5">
        <div className="flex items-center gap-1.5">
          <label
            htmlFor="report-day-hours"
            className="min-w-0 flex-1 text-[15px] leading-tight font-semibold"
          >
            Heures pour tous
          </label>
          <IconButton
            label="Une demi-heure de moins"
            onClick={() => setForm((current) => stepDayHours(current, -0.5))}
            className="border-line bg-surface text-text border"
          >
            <Minus aria-hidden />
          </IconButton>
          <Input
            id="report-day-hours"
            value={form.dayHours}
            onChange={(event) => setForm((current) => setDayHours(current, event.target.value))}
            onFocus={(event) => event.target.select()}
            inputMode="decimal"
            autoComplete="off"
            maxLength={6}
            className="font-display h-11 w-15 px-1 text-center text-lg font-bold tabular-nums"
          />
          <IconButton
            label="Une demi-heure de plus"
            onClick={() => setForm((current) => stepDayHours(current, 0.5))}
            className="border-line bg-surface text-text border"
          >
            <Plus aria-hidden />
          </IconButton>
        </div>
        <p className="text-dim mt-0.5 pr-2 pb-1 text-[13px] leading-snug">
          Ce nombre s&apos;applique à toute l&apos;équipe, sauf aux heures que vous avez changées
          une par une.
        </p>
      </div>

      {form.crew.length > 0 ? (
        <ul className="divide-line mt-2 divide-y">
          {form.crew.map((row) => (
            <CrewRowLine
              key={row.key}
              row={row}
              problem={problems.find((problem) => problem.rowKey === row.key)?.message}
              autoFocus={row.key === justAdded}
              onName={(name) => setForm((current) => setRowName(current, row.key, name))}
              onOpenHours={() => setEditing(row.key)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-dim px-1 pt-4 pb-1 text-[15px]">
          Personne n&apos;est inscrit pour cette journée.
        </p>
      )}

      {full ? (
        <p className="text-dim mt-3 text-sm">
          Un rapport compte {REPORT_LIMITS.crew} lignes au plus.
        </p>
      ) : (
        <>
          {/* One column that never grows past the card, whatever a button says. */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {previous ? (
              <Button variant="secondary" onClick={takePrevious} className="px-3">
                <History aria-hidden />
                <span className="min-w-0 truncate">
                  {previousCrewLabel(previous.day, form.day, today)}
                </span>
              </Button>
            ) : null}
            <Button variant="secondary" onClick={addName} className="px-3">
              <UserPlus aria-hidden /> Ajouter un nom
            </Button>
          </div>

          {members.data === undefined ? (
            members.isError || members.isPaused ? (
              <p className="text-dim mt-4 text-sm">
                La liste des personnes du projet n&apos;est pas disponible sans réseau. Ajoutez les
                noms à la main.
              </p>
            ) : (
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-11 w-36 rounded-full" />
                <Skeleton className="h-11 w-32 rounded-full" />
              </div>
            )
          ) : toAdd.length > 0 ? (
            <div className="mt-4">
              <div className="mb-1 flex min-h-11 items-center justify-between gap-2">
                <p className="text-sm font-semibold">Personnes du projet</p>
                {toAdd.length > 1 ? (
                  <Button
                    variant="ghost"
                    className="-mr-2 px-3"
                    onClick={() =>
                      setForm((current) => toAdd.reduce((next, m) => addMember(next, m), current))
                    }
                  >
                    Ajouter tout le monde
                  </Button>
                ) : null}
              </div>
              <ul className="flex flex-wrap gap-2">
                {toAdd.map((member) => (
                  <li key={member.id} className="max-w-full">
                    <button
                      type="button"
                      onClick={() => setForm((current) => addMember(current, member))}
                      className="border-line bg-surface hover:border-ead/60 active:bg-ead-tint inline-flex h-11 max-w-full cursor-pointer items-center gap-1 rounded-full border pr-3.5 pl-2.5 text-sm font-semibold transition-colors"
                    >
                      <Plus className="text-ead-dark size-4.5 shrink-0" aria-hidden />
                      <span className="truncate">{member.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <HoursSheet
        row={editedRow}
        onClose={() => setEditing(null)}
        onHours={(hours) => editing && setForm((current) => setRowHours(current, editing, hours))}
        onStep={(step) => editing && setForm((current) => stepRowHours(current, editing, step))}
        onRemove={() => {
          if (editing) setForm((current) => removeRow(current, editing));
          setEditing(null);
        }}
      />
    </div>
  );
}

/** "10 h" for hours that read; what was typed otherwise, to be corrected. */
function hoursLabel(text: string): string {
  const hours = parseHours(text);
  if (hours !== null && isValidHours(hours)) return formatHours(hours);
  return text.trim() || "—";
}

function CrewRowLine({
  row,
  problem,
  autoFocus,
  onName,
  onOpenHours,
}: {
  row: CrewRow;
  problem?: string;
  autoFocus: boolean;
  onName: (name: string) => void;
  onOpenHours: () => void;
}) {
  const named = Boolean(row.name.trim());
  return (
    <li className="py-1.5">
      <div className="flex items-center gap-2">
        {row.userId ? (
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar name={row.name} className="size-9 text-xs max-[400px]:hidden" />
            {/* Two people of one family often differ by the end of the name only. */}
            <span className="line-clamp-2 leading-tight font-semibold wrap-anywhere">
              {row.name}
            </span>
          </span>
        ) : (
          <Input
            value={row.name}
            onChange={(event) => onName(event.target.value)}
            placeholder="Nom ou entreprise"
            aria-label="Nom"
            aria-invalid={Boolean(problem) && !named}
            maxLength={REPORT_LIMITS.name}
            autoComplete="off"
            autoCapitalize="words"
            autoFocus={autoFocus}
            className="min-w-0 flex-1 px-3"
          />
        )}
        <button
          type="button"
          id={`crew-${row.key}`}
          onClick={onOpenHours}
          aria-label={`Heures de ${row.name.trim() || "cette personne"}\u00a0: ${hoursLabel(row.hours)}`}
          aria-describedby={problem ? `crew-${row.key}-problem` : undefined}
          data-invalid={(Boolean(problem) && named) || undefined}
          className={cn(
            "border-line bg-surface hover:border-ead/60 active:bg-ead-tint data-invalid:border-bad flex h-13 w-24 shrink-0 cursor-pointer items-center justify-between gap-1 rounded-xl border pr-2.5 pl-3.5 transition-colors",
            row.own && "border-ead/50 bg-ead-tint/60",
          )}
        >
          <span className="font-display truncate text-lg font-bold tabular-nums">
            {hoursLabel(row.hours)}
          </span>
          <ChevronDown className="text-dim size-4.5 shrink-0" aria-hidden />
        </button>
      </div>
      {problem ? (
        <p id={`crew-${row.key}-problem`} className="text-bad mt-1 text-sm font-medium">
          {problem}
        </p>
      ) : null}
    </li>
  );
}

/** The usual days, one tap each. */
const QUICK_HOURS = [7, 8, 9, 10, 11, 12];

/**
 * One person's hours without the keyboard: a usual day in one tap, half an
 * hour more or less, or any other number in the field. Taking the person off
 * the crew is here, at the bottom, where no tap lands by mistake.
 */
function HoursSheet({
  row,
  onClose,
  onHours,
  onStep,
  onRemove,
}: {
  row: CrewRow | null;
  onClose: () => void;
  onHours: (hours: string) => void;
  onStep: (step: number) => void;
  onRemove: () => void;
}) {
  // Keeps the window's text while it closes, once the line is gone.
  const [shown, setShown] = useState(row);
  if (row && row !== shown) setShown(row);
  const current = row ?? shown;
  const name = current?.name.trim() || "cette personne";
  const value = current ? parseHours(current.hours) : null;

  // "7.5" and "7h30" are rewritten "7,5" once the window closes.
  const close = () => {
    if (row && value !== null && isValidHours(value) && hoursText(value) !== row.hours)
      onHours(hoursText(value));
    onClose();
  };

  return (
    <Sheet
      open={row !== null}
      onClose={close}
      title={`Heures de ${name}`}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onRemove}
            className="text-bad hover:bg-bad-tint active:bg-bad-tint"
          >
            <UserMinus aria-hidden />
            Retirer de l&apos;équipe
          </Button>
          <Button size="lg" onClick={close}>
            OK
          </Button>
        </>
      }
    >
      <div role="group" aria-label="Heures habituelles" className="grid grid-cols-3 gap-2">
        {QUICK_HOURS.map((hours) => {
          const chosen = value === hours;
          return (
            <button
              key={hours}
              type="button"
              aria-pressed={chosen}
              onClick={() => {
                onHours(hoursText(hours));
                onClose();
              }}
              className={cn(
                "font-display h-14 cursor-pointer rounded-xl border text-lg font-bold tabular-nums transition-colors",
                chosen
                  ? "border-ead-dark bg-ead-dark text-white shadow-sm"
                  : "border-line bg-surface hover:border-ead/60 active:bg-ead-tint",
              )}
            >
              {formatHours(hours)}
            </button>
          );
        })}
      </div>

      <div className="bg-canvas mt-4 flex items-center gap-2 rounded-xl py-1.5 pr-1.5 pl-3.5">
        <label htmlFor="crew-hours-other" className="min-w-0 flex-1 text-[15px] font-semibold">
          Autre nombre
        </label>
        <IconButton
          label="Une demi-heure de moins"
          onClick={() => onStep(-0.5)}
          className="border-line bg-surface text-text size-12 border"
        >
          <Minus aria-hidden />
        </IconButton>
        <span className="relative">
          <Input
            id="crew-hours-other"
            value={current?.hours ?? ""}
            onChange={(event) => onHours(event.target.value)}
            onFocus={(event) => event.target.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") close();
            }}
            inputMode="decimal"
            autoComplete="off"
            maxLength={8}
            className="font-display w-20 pr-6 pl-1.5 text-center text-lg font-bold tabular-nums"
          />
          <span className="text-dim pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">
            h
          </span>
        </span>
        <IconButton
          label="Une demi-heure de plus"
          onClick={() => onStep(0.5)}
          className="border-line bg-surface text-text size-12 border"
        >
          <Plus aria-hidden />
        </IconButton>
      </div>
      <p className="text-dim mt-2 px-1 text-[13px] leading-snug">
        Au quart d&apos;heure près&nbsp;: 7,25 · 7,5 · 7,75.
      </p>
    </Sheet>
  );
}
