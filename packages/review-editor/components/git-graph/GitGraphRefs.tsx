import React from "react";
import type { CommitGraphEntry } from "@plannotator/shared/git-graph-history";

const BranchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 16" aria-hidden>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M10 5c0-1.11-.89-2-2-2a1.993 1.993 0 0 0-1 3.72v.3c-.02.52-.23.98-.63 1.38-.4.4-.86.61-1.38.63-.83.02-1.48.16-2 .45V4.72a1.993 1.993 0 0 0-1-3.72C.88 1 0 1.89 0 3a2 2 0 0 0 1 1.72v6.56c-.59.35-1 .99-1 1.72 0 1.11.89 2 2 2 1.11 0 2-.89 2-2 0-.53-.2-1-.53-1.36.09-.06.48-.41.59-.47.25-.11.56-.17.94-.17 1.05-.05 1.95-.45 2.75-1.25S8.95 7.77 9 6.73h-.02C9.59 6.37 10 5.73 10 5zM2 1.8c.66 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2C1.35 4.2.8 3.65.8 3c0-.65.55-1.2 1.2-1.2zm0 12.41c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2zm6-8c-.66 0-1.2-.55-1.2-1.2 0-.65.55-1.2 1.2-1.2.65 0 1.2.55 1.2 1.2 0 .65-.55 1.2-1.2 1.2z"
    />
  </svg>
);

const TagIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 15 16" aria-hidden>
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M7.73 1.73C7.26 1.26 6.62 1 5.96 1H3.5C2.13 1 1 2.13 1 3.5v2.47c0 .66.27 1.3.73 1.77l6.06 6.06c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 0 0 0-1.41L7.73 1.73zM2.38 7.09c-.31-.3-.47-.7-.47-1.13V3.5c0-.88.72-1.59 1.59-1.59h2.47c.42 0 .83.16 1.13.47l6.14 6.13-4.73 4.73-6.13-6.15zM3.01 3h2v2H3V3h.01z"
    />
  </svg>
);

function combinedRefs(commit: CommitGraphEntry) {
  const headSet = new Set(commit.heads);
  const combined: Record<string, string[]> = {};
  const remotes: string[] = [];
  for (const r of commit.remotes || []) {
    const slash = r.name.indexOf("/");
    const remote = slash >= 0 ? r.name.slice(0, slash) : r.remote;
    const branch = slash >= 0 ? r.name.slice(slash + 1) : r.name;
    if (headSet.has(branch)) {
      (combined[branch] ||= []).push(remote || "");
    } else {
      remotes.push(r.name);
    }
  }
  return { combined, remotes };
}

interface GitGraphRefsProps {
  commit: CommitGraphEntry;
  currentBranch: string | null;
  colour: string;
}

export const GitGraphRefs: React.FC<GitGraphRefsProps> = ({ commit, currentBranch, colour }) => {
  const { combined, remotes } = combinedRefs(commit);
  if (
    !(commit.heads && commit.heads.length) &&
    !remotes.length &&
    !(commit.tags && commit.tags.length) &&
    !commit.stash
  ) {
    return null;
  }

  return (
    <span className="pn-git-refs">
      {(commit.heads || []).map((name) => {
        const active = name === currentBranch;
        return (
          <span
            key={`head:${name}`}
            className={`pn-git-ref${active ? " active" : ""}`}
            data-ref-type="head"
            data-name={name}
            style={{ "--pn-git-ref-color": colour } as React.CSSProperties}
            title={name}
          >
            <span className="pn-git-ref-icon">
              <BranchIcon />
            </span>
            <span className="pn-git-ref-name">{name}</span>
            {(combined[name] || []).map((r) => {
              const full = `${r}/${name}`;
              return (
                <span
                  key={full}
                  className="pn-git-ref-remote"
                  data-ref-type="remote"
                  data-name={full}
                >
                  {r}
                </span>
              );
            })}
          </span>
        );
      })}
      {remotes.map((name) => (
        <span
          key={`remote:${name}`}
          className="pn-git-ref"
          data-ref-type="remote"
          data-name={name}
          style={{ "--pn-git-ref-color": colour } as React.CSSProperties}
          title={name}
        >
          <span className="pn-git-ref-icon">
            <BranchIcon />
          </span>
          <span className="pn-git-ref-name">{name}</span>
        </span>
      ))}
      {(commit.tags || []).map((tag) => (
        <span
          key={`tag:${tag.name}`}
          className="pn-git-ref tag"
          data-ref-type="tag"
          data-name={tag.name}
          data-annotated={tag.annotated ? "1" : "0"}
          title={tag.name}
        >
          <span className="pn-git-ref-icon">
            <TagIcon />
          </span>
          <span className="pn-git-ref-name">{tag.name}</span>
        </span>
      ))}
      {commit.stash && (
        <span
          className="pn-git-ref"
          data-ref-type="stash"
          data-name={commit.stash.selector}
          title={commit.stash.selector}
        >
          <span className="pn-git-ref-icon">
            <BranchIcon />
          </span>
          <span className="pn-git-ref-name">{commit.stash.selector}</span>
        </span>
      )}
    </span>
  );
};
