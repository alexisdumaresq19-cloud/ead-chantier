import type { UseQueryResult } from "@tanstack/react-query";
import { History, Minus, Plus, UserPlus, X } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";

import type { Member } from "@/shared/api";
import { isValidHours, REPORT_LIMITS, type CrewLine } from "@/shared/reports";

import { count } from "../../lib/format";
import { Avatar, Button, IconButton, Input, Skeleton, toast } from "../../ui";
import {
  addBlankRow,
  addMember,
  membersToAdd,
  removeRow,
  setDayHours,
  setRowHours,
  setRowName,
  stepDayHours,
  takeCrew,
  type CrewRow,
  type FormProblem,
  type ReportForm,
} from "./form";
import { hoursText, parseHours, previousCrewLabel } from "./lib";

// The crew of the day: one line per person, a name and hours. The people of
// the project are added in one tap, the hours of the day are set once for
// everyone, and yesterday's crew can be taken over as it was.

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
          Changer ce nombre change les heures de toute l&apos;équipe, sauf celles écrites à la main.
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
              onHours={(hours) => setForm((current) => setRowHours(current, row.key, hours))}
              onRemove={() => setForm((current) => removeRow(current, row.key))}
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
    </div>
  );
}

function CrewRowLine({
  row,
  problem,
  autoFocus,
  onName,
  onHours,
  onRemove,
}: {
  row: CrewRow;
  problem?: string;
  autoFocus: boolean;
  onName: (name: string) => void;
  onHours: (hours: string) => void;
  onRemove: () => void;
}) {
  // "7.5" and "7h30" are rewritten "7,5" once the field is left.
  const tidy = () => {
    const hours = parseHours(row.hours);
    if (hours !== null && isValidHours(hours) && hoursText(hours) !== row.hours)
      onHours(hoursText(hours));
  };
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
            aria-invalid={Boolean(problem) && !row.name.trim()}
            maxLength={REPORT_LIMITS.name}
            autoComplete="off"
            autoCapitalize="words"
            autoFocus={autoFocus}
            className="min-w-0 flex-1 px-3"
          />
        )}
        <span className="relative shrink-0">
          <Input
            id={`crew-${row.key}`}
            value={row.hours}
            onChange={(event) => onHours(event.target.value)}
            onFocus={(event) => event.target.select()}
            onBlur={tidy}
            inputMode="decimal"
            autoComplete="off"
            maxLength={8}
            aria-label={`Heures de ${row.name.trim() || "cette personne"}`}
            aria-invalid={Boolean(problem) && Boolean(row.name.trim())}
            className="w-21 pr-6 pl-1.5 text-center font-semibold tabular-nums"
          />
          <span className="text-dim pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
            h
          </span>
        </span>
        <IconButton
          label={`Retirer ${row.name.trim() || "cette ligne"}`}
          onClick={onRemove}
          className="-mr-2"
        >
          <X aria-hidden />
        </IconButton>
      </div>
      {problem ? <p className="text-bad mt-1 text-sm font-medium">{problem}</p> : null}
    </li>
  );
}
