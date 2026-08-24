import React, { useMemo } from "react";
import type { GraphLayout } from "@plannotator/shared/git-graph-history";
import { buildGraphDrawModel } from "../../utils/gitGraphDraw";

interface GitGraphSvgProps {
  layout: GraphLayout;
  onVertexClick: (id: number, ev: React.MouseEvent) => void;
}

export const GitGraphSvg: React.FC<GitGraphSvgProps> = ({ layout, onVertexClick }) => {
  const draw = useMemo(() => buildGraphDrawModel(layout), [layout]);

  return (
    <svg
      className="pn-commit-graph"
      width={draw.width}
      height={draw.height}
      viewBox={`0 0 ${draw.width} ${draw.height}`}
      style={{ width: draw.width, height: draw.height }}
      aria-hidden
    >
      {draw.paths.map((path, i) => (
        <React.Fragment key={i}>
          <path d={path.d} className="shadow" />
          <path
            d={path.d}
            className={path.isCommitted ? "line" : "line uncommitted"}
            stroke={path.isCommitted ? path.colour : "#808080"}
            strokeDasharray={path.isCommitted ? undefined : "2,2"}
          />
        </React.Fragment>
      ))}
      {draw.vertices.map((v) => (
        <g key={v.id}>
          {v.isStash && !v.isCurrent && (
            <circle
              cx={v.cx}
              cy={v.cy}
              r={2}
              className="stashInner"
              fill={v.colour}
            />
          )}
          <circle
            cx={v.cx}
            cy={v.cy}
            r={v.isStash && !v.isCurrent ? 4.5 : 4}
            className={v.isCurrent ? "current" : v.isStash ? "stashOuter" : undefined}
            fill={v.isCurrent || (v.isStash && !v.isCurrent) ? "var(--background)" : v.colour}
            stroke={v.isCurrent || (v.isStash && !v.isCurrent) ? v.colour : undefined}
            data-id={v.id}
            onClick={(ev) => {
              ev.stopPropagation();
              onVertexClick(v.id, ev);
            }}
          />
        </g>
      ))}
    </svg>
  );
};
