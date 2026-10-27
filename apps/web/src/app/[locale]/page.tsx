import React from 'react';
import { useTranslations } from 'next-intl';
import {
  ShieldAlert,
  Clock,
  FileCheck2,
  Building2,
  Users,
  Compass,
  ArrowRight,
  Sparkles,
  Server,
  Layers,
} from 'lucide-react';
import Link from 'next/link';

export default function HomePage({ params: { locale } }: { params: { locale: string } }) {
  const t = useTranslations('common');
  const tRoles = useTranslations('roles');

  const roleList = [
    { key: 'INSTITUTION', name: tRoles('INSTITUTION'), color: 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-300' },
    { key: 'SCRUTINY_OFFICER', name: tRoles('SCRUTINY_OFFICER'), color: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' },
    { key: 'REGIONAL_OFFICER', name: tRoles('REGIONAL_OFFICER'), color: 'bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300' },
    { key: 'EVC_MEMBER', name: tRoles('EVC_MEMBER'), color: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300' },
    { key: 'COMMITTEE_MEMBER', name: tRoles('COMMITTEE_MEMBER'), color: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300' },
    { key: 'BUREAU_OFFICER', name: tRoles('BUREAU_OFFICER'), color: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-300' },
    { key: 'ADMIN', name: tRoles('ADMIN'), color: 'bg-slate-500/10 border-slate-500/30 text-slate-700 dark:text-slate-300' },
  ];

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top AICTE Gov Banner */}
      <div className="bg-[#0b1d3a] text-white border-b border-blue-950">
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between text-xs tracking-wide">
          <div className="flex items-center space-x-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-slate-200">
              ALL INDIA COUNCIL FOR TECHNICAL EDUCATION • APPROVAL BUREAU (SIH26262)
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-slate-300">AY 2026-27 Active</span>
            <div className="flex items-center space-x-2">
              <Link
                href="/en"
                className={`px-2 py-0.5 rounded text-xs transition ${
                  locale === 'en' ? 'bg-amber-500 font-bold text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                EN
              </Link>
              <span className="text-slate-500">|</span>
              <Link
                href="/hi"
                className={`px-2 py-0.5 rounded text-xs transition ${
                  locale === 'hi' ? 'bg-amber-500 font-bold text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                हिन्दी
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Header / Nav */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-tr from-amber-600 via-amber-500 to-yellow-400 flex items-center justify-center shadow-md shadow-amber-500/20 text-white font-black text-xl">
              A
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
                {t('title')}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Server className="w-3.5 h-3.5 mr-1" /> Control Tower Engine Online
            </span>
          </div>
        </div>
      </header>

      {/* Hero Control Tower Banner */}
      <section className="bg-gradient-to-b from-blue-950 via-[#0d2244] to-slate-900 text-white py-14 px-4 border-b border-blue-900">
        <div className="max-w-7xl mx-auto">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Rule-Gated State Machine • Dual-Clock Tracking • Hash-Chained Audit Ledger
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-4">
              Mission-Critical Command Center for National Technical Approvals
            </h2>
            <p className="text-slate-300 text-base leading-relaxed mb-6">
              Empowering institutions, scrutiny officers, and regional committees with
              tamper-evident audit trails, dual SLA clocks, compliance expiry radar, and AI-assisted recommendations.
            </p>
          </div>

          {/* Key Stat / Architecture Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('institutionClock')}
                </span>
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold text-white">4.2 <span className="text-xs font-normal text-slate-300">days avg</span></div>
              <p className="text-xs text-slate-400 mt-1">Deficiency resolution clock</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('aicteClock')}
                </span>
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
              <div className="text-2xl font-bold text-white">8.5 <span className="text-xs font-normal text-slate-300">days avg</span></div>
              <p className="text-xs text-slate-400 mt-1">Scrutiny + EVC processing</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Compliance Radar
                </span>
                <ShieldAlert className="w-4 h-4 text-rose-400" />
              </div>
              <div className="text-2xl font-bold text-white">150 <span className="text-xs font-normal text-slate-300">monitored</span></div>
              <p className="text-xs text-slate-400 mt-1">Fire NOC, Land & Affiliations</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Audit Ledger
                </span>
                <FileCheck2 className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold text-emerald-400">SHA-256 <span className="text-xs font-normal text-slate-300">Verified</span></div>
              <p className="text-xs text-slate-400 mt-1">Append-only cryptographic chain</p>
            </div>
          </div>
        </div>
      </section>

      {/* Role Navigation Grid */}
      <section className="max-w-7xl mx-auto px-4 py-12 flex-1 w-full">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-amber-500" /> Role-Gated Workspaces
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Select a role to preview role-specific dashboards, workflows, and task assignments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {roleList.map((role) => (
            <div
              key={role.key}
              className={`p-5 rounded-xl border ${role.color} transition duration-200 hover:shadow-md flex flex-col justify-between`}
            >
              <div>
                <span className="text-xs font-mono font-bold uppercase tracking-wider opacity-75">
                  {role.key}
                </span>
                <h4 className="text-base font-semibold mt-1 mb-2">{role.name}</h4>
                <p className="text-xs opacity-80 leading-relaxed">
                  Dedicated view with rule-gated actions, assigned dossiers, and SLA alert tracking.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-current/10 flex items-center justify-between text-xs font-semibold">
                <span>Access Console</span>
                <ArrowRight className="w-4 h-4 ml-1" />
              </div>
            </div>
          ))}
        </div>

        {/* Workflow State Machine Preview */}
        <div className="mt-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-blue-600" />
            15-State Approval Engine & 4 Configurable Tracks
          </h3>
          <div className="flex flex-wrap gap-2 text-xs font-medium">
            {[
              'DRAFT',
              'SUBMITTED',
              'UNDER_SCRUTINY',
              'DEFICIENCY_RAISED',
              'RESUBMITTED',
              'SCRUTINY_CLEARED',
              'EVC_REQUIRED',
              'EVC_SCHEDULED',
              'EVC_IN_PROGRESS',
              'EVC_COMPLETED',
              'COMMITTEE_REVIEW',
              'FINAL_DECISION',
              'APPROVED',
              'APPROVED_WITH_CONDITIONS',
              'REJECTED',
            ].map((st, i) => (
              <span
                key={st}
                className="px-3 py-1.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 font-mono"
              >
                {i + 1}. {st}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 text-xs py-6 border-t border-slate-800 text-center">
        <p>AICTE Approval Control Tower • SIH26262 AICTE Regulation Bureau</p>
        <p className="mt-1 text-slate-500">
          Strict Human Decision Rule: Automation never approves or rejects. AI provides suggestions only.
        </p>
      </footer>
    </main>
  );
}
