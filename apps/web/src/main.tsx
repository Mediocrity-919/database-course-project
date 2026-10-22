import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./api.js";
import { Protected, Shell } from "./ui.js";
import { AuthPage, Dashboard, NewSurvey, Guide } from "./pages/Home.js";
import { Editor } from "./pages/Editor.js";
import { Share, Results } from "./pages/Manage.js";
import { SurveyEntry, FillSurvey, Complete } from "./pages/Fill.js";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/survey/:publicId" element={<SurveyEntry />} />
          <Route
            path="/survey/:publicId/attempt/:attemptId"
            element={<FillSurvey />}
          />
          <Route
            path="/survey/:publicId/complete/:attemptId"
            element={<Complete />}
          />
          <Route element={<Protected />}>
            <Route element={<Shell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/new" element={<NewSurvey />} />
              <Route path="/guide" element={<Guide />} />
              <Route path="/surveys/:id/edit" element={<Editor />} />
              <Route path="/surveys/:id/preview" element={<Editor preview />} />
              <Route path="/surveys/:id/share" element={<Share />} />
              <Route path="/surveys/:id/results" element={<Results />} />
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <div className="public-container">
                <h1>页面不存在</h1>
                <a href="/">返回工作台</a>
              </div>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
