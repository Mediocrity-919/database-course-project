import type { ReactNode } from "react";
import {
  ArrowUpRight,
  LayoutDashboard,
  LogOut,
  Plus,
  Sprout,
  BookOpen,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./api.js";
export function Brand() {
  return (
    <Link className="brand" to="/dashboard">
      <span className="brand-mark">
        <Sprout size={23} />
      </span>
      <span>
        问笺<span className="brand-en">SURVEY STUDIO</span>
      </span>
    </Link>
  );
}
export function Button({
  children,
  variant = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) {
  return (
    <button {...props} className={`btn ${variant} ${props.className ?? ""}`}>
      {children}
    </button>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <div className="error" role="alert">
      {message}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading">
      <span className="spinner" />
      正在整理内容…
    </div>
  );
}
export function Status({ status }: { status: string }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {(
        {
          draft: "草稿",
          published: "收集中",
          closed: "已关闭",
          expired: "已截止",
        } as Record<string, string>
      )[status] ?? status}
    </span>
  );
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <div className="title-actions">{children}</div>
    </div>
  );
}
export function Back({ to = "/dashboard" }: { to?: string }) {
  return (
    <Link className="back" to={to}>
      <ArrowLeft size={15} />
      返回{to === "/dashboard" ? "我的问卷" : "问卷"}
    </Link>
  );
}
export function Protected() {
  const { user, loading } = useAuth(),
    location = useLocation();
  if (loading) return <Loading />;
  if (!user)
    return (
      <Navigate
        to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  return <Outlet />;
}
export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const inLibrary = location.pathname === "/library";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">个人工作空间</div>
        <nav>
          <Link
            className={`nav-item ${location.pathname === "/dashboard" ? "active" : ""}`}
            to="/dashboard"
          >
            <LayoutDashboard size={18} />
            我的问卷
            <ChevronRight size={15} />
          </Link>
          <Link
            className={`nav-item ${inLibrary ? "active" : ""}`}
            to="/library"
          >
            <BookOpen size={18} />
            我的题库
            <ChevronRight size={15} />
          </Link>
          <Link className="nav-item" to="/guide">
            <BookOpen size={18} />
            使用指南
            <ArrowUpRight size={15} />
          </Link>
        </nav>
        <div className="sidebar-tip">
          <span className="tip-icon">✳</span>
          <strong>从一个好问题开始</strong>
          <p>让每一份回答，成为有价值的发现。</p>
          <Link to="/new">
            创建第一份问卷 <Plus size={14} />
          </Link>
        </div>
        <div className="account">
          <div className="avatar">
            {user?.username.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user?.username}</strong>
            <span>个人账号</span>
          </div>
          <button
            title="退出登录"
            aria-label="退出登录"
            onClick={() => void logout()}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            工作空间 <ChevronRight size={13} />{" "}
            {inLibrary ? "我的题库" : "我的问卷"}
          </span>
          <span className="topbar-note">
            <i />
            让好奇心有迹可循
          </span>
        </header>
        <nav className="mobile-nav" aria-label="手机导航">
          <Link to="/dashboard">我的问卷</Link>
          <Link to="/library">我的题库</Link>
          <Link to="/guide">使用指南</Link>
        </nav>
        <main className="main">
          <Outlet />
        </main>
        <footer>
          问笺 Survey Studio<span>基于 MongoDB 的问卷系统 · 第二阶段</span>
        </footer>
      </div>
    </div>
  );
}
export const dateText = (s: string | null) =>
  s
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(s))
    : "未设置";
export const chinaDateTimeInput = (s: string | null) =>
  s
    ? new Date(new Date(s).getTime() + 8 * 3600_000).toISOString().slice(0, 16)
    : "";
export const chinaDateTimeIso = (s: string) =>
  s ? new Date(s + ":00+08:00").toISOString() : null;
