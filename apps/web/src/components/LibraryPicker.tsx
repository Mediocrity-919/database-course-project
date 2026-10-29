import { useState } from "react";
import type { Question } from "../../../../packages/shared/src/domain.js";
import { api, json, useData } from "../api.js";
import { Button, ErrorBox, Loading } from "../ui.js";

export function LibraryPicker({
  onSelect,
  label = "从题库选题",
}: {
  onSelect: (q: Question) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="library-picker">
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && (
        <Picker
          onSelect={(q) => {
            onSelect(q);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
function Picker({ onSelect }: { onSelect: (q: Question) => void }) {
  const [page, setPage] = useState(1),
    [bank, setBank] = useState(""),
    [family, setFamily] = useState(""),
    [error, setError] = useState("");
  const banks = useData("/question-banks"),
    list = useData(
      `/library/questions?page=${page}${bank ? "&bankId=" + bank : ""}`,
    );
  return (
    <div className="library-picker-content">
      <ErrorBox message={error || list.error} />
      <label>
        筛选题库
        <select
          aria-label="筛选题库"
          value={bank}
          onChange={(e) => {
            setBank(e.target.value);
            setPage(1);
            setFamily("");
          }}
        >
          <option value="">全部可用题目（含共享）</option>
          {banks.data?.items.map((b: any) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {list.loading ? (
        <Loading />
      ) : (
        list.data?.items.map((f: any) => (
          <Button
            key={f._id}
            variant="secondary"
            onClick={() => setFamily(f._id)}
          >
            {f.latest.content.title} · v{f.latest.versionNumber}
          </Button>
        ))
      )}
      {!list.loading && !list.data?.items.length && (
        <p>暂无题目，先在“我的题库”保存常用题。</p>
      )}
      <div className="title-actions">
        <Button
          disabled={page === 1}
          onClick={() => {
            setPage(page - 1);
            setFamily("");
          }}
        >
          上一页
        </Button>
        <Button
          disabled={!list.data?.hasMore}
          onClick={() => {
            setPage(page + 1);
            setFamily("");
          }}
        >
          下一页
        </Button>
      </div>
      {family && (
        <VersionChoices
          key={family}
          id={family}
          pick={async (id) => {
            try {
              onSelect(
                await api(`/library/versions/${id}/import`, {
                  method: "POST",
                  body: json({}),
                }),
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}
function VersionChoices({
  id,
  pick,
}: {
  id: string;
  pick: (id: string) => Promise<void>;
}) {
  const [page, setPage] = useState(1),
    [busy, setBusy] = useState(false),
    d = useData(`/library/questions/${id}?page=${page}`);
  return (
    <div>
      <h4>选择固定版本</h4>
      <ErrorBox message={d.error} />
      {d.data?.versions.map((v: any) => (
        <Button
          key={v._id}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await pick(v._id);
            } finally {
              setBusy(false);
            }
          }}
        >
          使用 v{v.versionNumber}：{v.content.title}
        </Button>
      ))}
      <div className="title-actions">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
          较新版本
        </Button>
        <Button disabled={!d.data?.hasMore} onClick={() => setPage(page + 1)}>
          更早版本
        </Button>
      </div>
    </div>
  );
}
