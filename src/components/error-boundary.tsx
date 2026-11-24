"use client";

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { formatUserFacingError } from "@/lib/utils/errorMessages";

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: formatUserFacingError(error),
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#121414] p-6">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/40 bg-white dark:bg-[#1B1C1C] p-6 shadow-xl space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <AlertTriangle className="h-6 w-6 text-[#F59E0B]" />
            </div>
            <div className="space-y-1">
              <h2 className="font-display text-lg font-semibold text-[#0F172A] dark:text-[#E3E2E2]">
                TerraPulse Recovery Guard
              </h2>
              <p className="text-xs text-[#64748B] dark:text-[#C4C7C7]">
                {this.state.errorMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: "" });
                if (typeof window !== "undefined") window.location.reload();
              }}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#006600] dark:bg-[#10B981] px-5 font-mono text-xs font-semibold text-white dark:text-[#090D16] cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reload Workspace</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
