import { create } from "zustand";

interface FieldErrors {
  errors: Record<string, string>;
  report(id: string, error: string | null): void;
}

export const useFieldErrors = create<FieldErrors>((set) => ({
  errors: {},
  report: (id, error) =>
    set((s) => {
      if ((s.errors[id] ?? null) === error) return s;
      const errors = { ...s.errors };
      if (error === null) delete errors[id];
      else errors[id] = error;
      return { errors };
    }),
}));

export const fieldErrorCount = (s: FieldErrors): number => Object.keys(s.errors).length;
