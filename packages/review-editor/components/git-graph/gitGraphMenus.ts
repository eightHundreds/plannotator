import { toast } from "sonner";
import type { CommitGraphEntry } from "@plannotator/shared/git-graph-history";
import { UNCOMMITTED_HASH } from "@plannotator/shared/git-graph-history";
import type { GitGraphMenuItem } from "./GitGraphMenu";
import type { GitGraphPromptSpec } from "./GitGraphPrompt";

function abbrev(hash: string): string {
  return hash.length > 7 ? hash.slice(0, 7) : hash;
}

export type GraphActionHost = {
  branch: string | null;
  remotes: string[];
  run: (action: string, params?: Record<string, unknown>) => Promise<void>;
  prompt: (spec: GitGraphPromptSpec) => void;
  copy: (text: string) => void;
  showTagDetails: (name: string) => void;
};

function toastError(err: unknown) {
  toast.error(err instanceof Error ? err.message : String(err));
}

function fire(host: GraphActionHost, action: string, params?: Record<string, unknown>) {
  return () => {
    void host.run(action, params).catch(toastError);
  };
}

function checkoutTargetFor(commit: CommitGraphEntry, currentBranch: string | null): string {
  if (commit.heads && commit.heads.length) {
    if (currentBranch && commit.heads.includes(currentBranch)) return currentBranch;
    return commit.heads[0];
  }
  return commit.sha;
}

function mergeDialog(host: GraphActionHost, ref: string, label: string): GitGraphPromptSpec {
  return {
    title: "Merge",
    fields: [
      { id: "note", type: "note", text: `Merge ${label} into the current branch?` },
      { id: "noFastForward", type: "checkbox", label: "Create a merge commit even if fast-forward" },
      { id: "squash", type: "checkbox", label: "Squash" },
    ],
    confirmText: "Merge",
    onConfirm: (values) =>
      host.run("merge", {
        ref,
        noFastForward: Boolean(values.noFastForward),
        squash: Boolean(values.squash),
      }),
  };
}

function rebaseDialog(host: GraphActionHost, ref: string, label: string): GitGraphPromptSpec {
  return {
    title: "Rebase",
    fields: [{ id: "note", type: "note", text: `Rebase the current branch onto ${label}?` }],
    confirmText: "Rebase",
    variant: "warning",
    onConfirm: () => host.run("rebase", { ref }),
  };
}

export function commitMenuItems(commit: CommitGraphEntry, host: GraphActionHost): GitGraphMenuItem[] {
  if (commit.sha === UNCOMMITTED_HASH) return uncommittedMenuItems(host);
  if (commit.stash) return stashMenuItems(commit, host);

  const target = checkoutTargetFor(commit, host.branch);
  const checkoutLabel =
    commit.heads && commit.heads.includes(target)
      ? `Checkout branch "${target}"`
      : `Checkout commit ${abbrev(target)}`;
  const isMerge = (commit.parents || []).length > 1;

  return [
    {
      label: "Add tag…",
      run: () =>
        host.prompt({
          title: "Add tag",
          fields: [
            { id: "name", type: "text", label: "Name", autofocus: true },
            { id: "message", type: "text", label: "Message (annotated)" },
            { id: "annotated", type: "checkbox", label: "Annotated tag", defaultValue: true },
          ],
          confirmText: "Add tag",
          onConfirm: (values) => {
            const name = String(values.name ?? "").trim();
            if (!name) throw new Error("Name is required");
            return host.run("addTag", {
              name,
              hash: commit.sha,
              message: String(values.message ?? ""),
              annotated: Boolean(values.annotated),
            });
          },
        }),
    },
    {
      label: "Create branch…",
      run: () =>
        host.prompt({
          title: "Create branch",
          fields: [
            { id: "name", type: "text", label: "Name", autofocus: true },
            { id: "checkout", type: "checkbox", label: "Checkout after create" },
          ],
          confirmText: "Create",
          onConfirm: (values) => {
            const name = String(values.name ?? "").trim();
            if (!name) throw new Error("Name is required");
            return host.run("createBranch", {
              name,
              commitHash: commit.sha,
              checkout: Boolean(values.checkout),
            });
          },
        }),
    },
    { separator: true },
    { label: checkoutLabel, run: fire(host, "checkout", { target }) },
    {
      label: "Cherry pick…",
      run: () =>
        host.prompt({
          title: "Cherry pick",
          fields: [
            ...(isMerge
              ? [{ id: "parentIndex", type: "number" as const, label: "Parent index", defaultValue: "1" }]
              : []),
            { id: "recordOrigin", type: "checkbox", label: "Record origin" },
            { id: "noCommit", type: "checkbox", label: "No commit" },
          ],
          confirmText: "Cherry pick",
          onConfirm: (values) =>
            host.run("cherryPick", {
              hash: commit.sha,
              recordOrigin: Boolean(values.recordOrigin),
              noCommit: Boolean(values.noCommit),
              parentIndex: isMerge ? Number(values.parentIndex || 1) : 0,
            }),
        }),
    },
    {
      label: "Revert…",
      run: () =>
        host.prompt({
          title: "Revert commit",
          fields: isMerge
            ? [
                { id: "parentIndex", type: "number", label: "Parent index", defaultValue: "1" },
                { id: "note", type: "note", text: `Revert merge ${abbrev(commit.sha)}?` },
              ]
            : [{ id: "note", type: "note", text: `Revert ${abbrev(commit.sha)}?` }],
          confirmText: "Revert",
          variant: "warning",
          onConfirm: (values) =>
            host.run("revert", {
              hash: commit.sha,
              parentIndex: isMerge ? Number(values.parentIndex || 1) : 0,
            }),
        }),
    },
    {
      label: "Drop commit…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Drop commit",
          fields: [
            {
              id: "note",
              type: "note",
              text: `Permanently drop ${abbrev(commit.sha)} from the current branch?`,
            },
          ],
          confirmText: "Drop",
          variant: "warning",
          onConfirm: () => host.run("dropCommit", { hash: commit.sha }),
        }),
    },
    { separator: true },
    {
      label: "Merge into current branch…",
      run: () => host.prompt(mergeDialog(host, commit.sha, abbrev(commit.sha))),
    },
    {
      label: "Rebase current branch on this commit…",
      run: () => host.prompt(rebaseDialog(host, commit.sha, abbrev(commit.sha))),
    },
    {
      label: "Reset current branch to this commit…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Reset",
          fields: [
            { id: "note", type: "note", text: `Reset current branch to ${abbrev(commit.sha)}` },
            {
              id: "mode",
              type: "radio",
              name: "mode",
              defaultValue: "mixed",
              options: [
                { value: "soft", label: "Soft" },
                { value: "mixed", label: "Mixed" },
                { value: "hard", label: "Hard" },
              ],
            },
          ],
          confirmText: "Reset",
          variant: "warning",
          onConfirm: (values) => host.run("reset", { hash: commit.sha, mode: values.mode }),
        }),
    },
    { separator: true },
    { label: "Copy commit hash", run: () => host.copy(commit.sha) },
    { label: "Copy commit subject", run: () => host.copy(commit.subject) },
  ];
}

export function uncommittedMenuItems(host: GraphActionHost): GitGraphMenuItem[] {
  return [
    {
      label: "Stash uncommitted changes…",
      run: () =>
        host.prompt({
          title: "Stash",
          fields: [
            { id: "message", type: "text", label: "Message" },
            { id: "includeUntracked", type: "checkbox", label: "Include untracked", defaultValue: true },
          ],
          confirmText: "Stash",
          onConfirm: (values) =>
            host.run("stash", {
              message: String(values.message ?? "").trim(),
              includeUntracked: Boolean(values.includeUntracked),
            }),
        }),
    },
    {
      label: "Reset uncommitted changes…",
      run: () =>
        host.prompt({
          title: "Reset uncommitted",
          fields: [
            {
              id: "mode",
              type: "radio",
              name: "mode",
              defaultValue: "mixed",
              options: [
                { value: "mixed", label: "Mixed" },
                { value: "hard", label: "Hard" },
              ],
            },
          ],
          confirmText: "Reset",
          variant: "warning",
          onConfirm: (values) => host.run("resetUncommitted", { mode: values.mode }),
        }),
    },
    {
      label: "Clean untracked files…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Clean",
          fields: [
            { id: "note", type: "note", text: "Delete untracked files?" },
            { id: "directories", type: "checkbox", label: "Include directories", defaultValue: true },
          ],
          confirmText: "Clean",
          variant: "warning",
          onConfirm: (values) => host.run("clean", { directories: Boolean(values.directories) }),
        }),
    },
  ];
}

export function stashMenuItems(commit: CommitGraphEntry, host: GraphActionHost): GitGraphMenuItem[] {
  const selector = commit.stash!.selector;
  return [
    {
      label: "Apply stash…",
      run: () =>
        host.prompt({
          title: "Apply stash",
          fields: [{ id: "reinstateIndex", type: "checkbox", label: "Reinstate index" }],
          confirmText: "Apply",
          onConfirm: (values) =>
            host.run("stashApply", { selector, reinstateIndex: Boolean(values.reinstateIndex) }),
        }),
    },
    {
      label: "Pop stash…",
      run: () =>
        host.prompt({
          title: "Pop stash",
          fields: [{ id: "note", type: "note", text: `Pop ${selector}?` }],
          confirmText: "Pop",
          variant: "warning",
          onConfirm: () => host.run("stashPop", { selector }),
        }),
    },
    {
      label: "Drop stash…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Drop stash",
          fields: [{ id: "note", type: "note", text: `Drop ${selector}?` }],
          confirmText: "Drop",
          variant: "warning",
          onConfirm: () => host.run("stashDrop", { selector }),
        }),
    },
    {
      label: "Create branch from stash…",
      run: () =>
        host.prompt({
          title: "Branch from stash",
          fields: [{ id: "name", type: "text", label: "Name", autofocus: true }],
          confirmText: "Create",
          onConfirm: (values) => {
            const name = String(values.name ?? "").trim();
            if (!name) throw new Error("Name is required");
            return host.run("stashBranch", { name, selector });
          },
        }),
    },
    { separator: true },
    { label: "Copy stash name", run: () => host.copy(selector) },
  ];
}

export function headMenuItems(name: string, host: GraphActionHost): GitGraphMenuItem[] {
  return [
    { label: `Checkout branch "${name}"`, run: fire(host, "checkout", { target: name }) },
    {
      label: "Rename branch…",
      run: () =>
        host.prompt({
          title: "Rename branch",
          fields: [{ id: "newName", type: "text", label: "New name", defaultValue: name, autofocus: true }],
          confirmText: "Rename",
          onConfirm: (values) => {
            const newName = String(values.newName ?? "").trim();
            if (!newName) throw new Error("Name is required");
            return host.run("renameBranch", { oldName: name, newName });
          },
        }),
    },
    {
      label: "Delete branch…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Delete branch",
          fields: [
            { id: "note", type: "note", text: `Delete ${name}?` },
            { id: "force", type: "checkbox", label: "Force delete" },
          ],
          confirmText: "Delete",
          variant: "warning",
          onConfirm: (values) => host.run("deleteBranch", { name, force: Boolean(values.force) }),
        }),
    },
    { label: "Merge into current branch…", run: () => host.prompt(mergeDialog(host, name, name)) },
    {
      label: "Rebase current branch on this branch…",
      run: () => host.prompt(rebaseDialog(host, name, name)),
    },
    ...(host.remotes.length
      ? [
          {
            label: "Push branch…",
            run: () =>
              host.prompt({
                title: "Push branch",
                fields: [
                  {
                    id: "remote",
                    type: "select" as const,
                    label: "Remote",
                    options: host.remotes.map((r) => ({ value: r, label: r })),
                    defaultValue: host.remotes[0],
                  },
                  { id: "setUpstream", type: "checkbox" as const, label: "Set upstream", defaultValue: true },
                  { id: "force", type: "checkbox" as const, label: "Force" },
                ],
                confirmText: "Push",
                variant: "warning" as const,
                onConfirm: (values: Record<string, string | boolean>) =>
                  host.run("pushBranch", {
                    name,
                    remote: values.remote,
                    setUpstream: Boolean(values.setUpstream),
                    force: Boolean(values.force),
                  }),
              }),
          } satisfies GitGraphMenuItem,
        ]
      : []),
    { separator: true },
    { label: "Copy branch name", run: () => host.copy(name) },
  ];
}

export function remoteMenuItems(fullName: string, host: GraphActionHost): GitGraphMenuItem[] {
  const slash = fullName.indexOf("/");
  const remote = slash >= 0 ? fullName.slice(0, slash) : host.remotes[0] || "origin";
  const branch = slash >= 0 ? fullName.slice(slash + 1) : fullName;
  return [
    { label: `Checkout "${fullName}"…`, run: fire(host, "checkout", { target: fullName }) },
    {
      label: "Delete remote branch…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Delete remote branch",
          fields: [{ id: "note", type: "note", text: `Delete ${fullName}?` }],
          confirmText: "Delete",
          variant: "warning",
          onConfirm: () => host.run("deleteRemoteBranch", { remote, name: branch }),
        }),
    },
    {
      label: "Fetch into local branch…",
      run: () =>
        host.prompt({
          title: "Fetch into local",
          fields: [
            { id: "localBranch", type: "text", label: "Local branch", defaultValue: branch, autofocus: true },
            { id: "force", type: "checkbox", label: "Force" },
          ],
          confirmText: "Fetch",
          onConfirm: (values) =>
            host.run("fetchIntoLocal", {
              remote,
              remoteBranch: branch,
              localBranch: String(values.localBranch ?? "").trim() || branch,
              force: Boolean(values.force),
            }),
        }),
    },
    { label: "Merge into current branch…", run: () => host.prompt(mergeDialog(host, fullName, fullName)) },
    {
      label: "Pull into current branch…",
      run: () =>
        host.prompt({
          title: "Pull",
          fields: [
            { id: "note", type: "note", text: `Pull ${fullName}?` },
            { id: "noFastForward", type: "checkbox", label: "No fast-forward" },
            { id: "squash", type: "checkbox", label: "Squash" },
          ],
          confirmText: "Pull",
          onConfirm: (values) =>
            host.run("pull", {
              remote,
              branch,
              noFastForward: Boolean(values.noFastForward),
              squash: Boolean(values.squash),
            }),
        }),
    },
    { separator: true },
    { label: "Copy branch name", run: () => host.copy(fullName) },
  ];
}

export function tagMenuItems(name: string, annotated: boolean, host: GraphActionHost): GitGraphMenuItem[] {
  return [
    ...(annotated
      ? [
          {
            label: "View details",
            run: () => host.showTagDetails(name),
          } satisfies GitGraphMenuItem,
        ]
      : []),
    {
      label: "Delete tag…",
      danger: true,
      run: () =>
        host.prompt({
          title: "Delete tag",
          fields: [
            { id: "note", type: "note", text: `Delete tag ${name}?` },
            ...(host.remotes.length
              ? [
                  {
                    id: "remote",
                    type: "select" as const,
                    label: "Also delete on remote",
                    options: host.remotes.map((r) => ({ value: r, label: r })),
                    emptyLabel: "(local only)",
                    defaultValue: "",
                  },
                ]
              : []),
          ],
          confirmText: "Delete",
          variant: "warning",
          onConfirm: (values) =>
            host.run("deleteTag", {
              name,
              remote: String(values.remote ?? ""),
            }),
        }),
    },
    ...(host.remotes.length
      ? [
          {
            label: "Push tag…",
            run: () =>
              host.prompt({
                title: "Push tag",
                fields: [
                  {
                    id: "remote",
                    type: "select" as const,
                    label: "Remote",
                    options: host.remotes.map((r) => ({ value: r, label: r })),
                    defaultValue: host.remotes[0],
                  },
                ],
                confirmText: "Push",
                onConfirm: (values: Record<string, string | boolean>) =>
                  host.run("pushTag", { name, remote: values.remote }),
              }),
          } satisfies GitGraphMenuItem,
        ]
      : []),
    { separator: true },
    { label: "Copy tag name", run: () => host.copy(name) },
  ];
}
