import { useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

type YearKey = '2018' | '2019'

const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']

function formatM(v: number): string {
  const n = Math.round(v)
  return `${n}M`
}

function WaveLogo() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl bg-white shadow-[0_14px_30px_rgba(26,29,46,0.08)] flex items-center justify-center">
        <svg width="26" height="18" viewBox="0 0 26 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M1 13C4.5 5.5 8.5 5.5 12 13C15.5 20.5 19.5 20.5 25 7"
            stroke="#7C3AED"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M1 10C4.5 2.5 8.5 2.5 12 10C15.5 17.5 19.5 17.5 25 4"
            stroke="#0FA79D"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.95"
          />
          <path
            d="M1 16C4.5 8.5 8.5 8.5 12 16C15.5 23.5 19.5 23.5 25 10"
            stroke="#F5B400"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.95"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="text-[16px] font-extrabold text-textPrimary tracking-tight">Abces Software</div>
        <div className="mt-0.5 text-[10px] tracking-[0.18em] font-extrabold text-textSecondary uppercase">
          Profits and Loss Dashboard 2025
        </div>
      </div>
    </div>
  )
}

function YearSelector({ value, onChange }: { value: YearKey; onChange: (v: YearKey) => void }) {
  const items: YearKey[] = ['2018', '2019']
  return (
    <div className="flex gap-3">
      {items.map((y) => {
        const active = y === value
        return (
          <button
            key={y}
            type="button"
            onClick={() => onChange(y)}
            className={
              'h-11 flex-1 rounded-xl text-[13px] font-extrabold transition ' +
              (active
                ? 'text-white bg-gradient-to-r from-purple to-[#4C1D95] shadow-[0_16px_34px_rgba(124,58,237,0.28)]'
                : 'text-textSecondary bg-[#EEF1F7] border border-[rgba(145,150,168,0.18)] hover:text-textPrimary')
            }
          >
            {y}
          </button>
        )
      })}
    </div>
  )
}

function CompanyCard() {
  const rows = [
    { k: 'Website', v: 'http://bit.ly/abces' },
    { k: 'Location', v: 'Surabaya, Indonesia' },
    { k: 'No. of Employees', v: '2,750 people' },
    { k: 'Working Hours', v: 'Mon–Fri 8:00–17:00' },
    { k: 'Manager', v: 'Wasen' },
  ]
  return (
    <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-4 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.k}>
            <div className="text-[10px] tracking-[0.18em] font-extrabold text-textSecondary uppercase">{r.k}</div>
            <div className="mt-1 text-[13px] font-extrabold text-textPrimary">{r.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DonutRow({ title, percent, value, color }: { title: string; percent: number; value: string; color: string }) {
  const data = useMemo(() => [{ name: title, value: percent }, { name: 'rest', value: 100 - percent }], [percent, title])
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[74px] w-[74px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={26}
              outerRadius={34}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              <Cell fill={color} />
              <Cell fill="rgba(145,150,168,0.15)" />
            </Pie>
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#1A1D2E"
              fontSize="14"
              fontWeight="900"
            >
              {percent}%
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] tracking-[0.18em] font-extrabold text-textSecondary uppercase">{title}</div>
        <div className="mt-1 text-[18px] font-extrabold text-textPrimary">{value}</div>
      </div>
    </div>
  )
}

function StatCard({
  title,
  value,
  delta,
  sub,
  from,
  to,
}: {
  title: string
  value: string
  delta?: string
  sub?: string
  from: string
  to: string
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl p-5 text-white shadow-[0_20px_45px_rgba(26,29,46,0.16)]"
      style={{ backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }}
    >
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
      <div className="absolute right-10 top-8 h-16 w-16 rounded-full bg-white/7" />
      <div className="relative">
        <div className="text-[12px] font-semibold opacity-95">{title}</div>
        <div className="mt-2 text-[26px] font-extrabold tracking-tight">{value}</div>
        <div className="mt-1 text-[12px] font-semibold opacity-95">{delta ?? sub}</div>
      </div>
    </div>
  )
}

function GrossProfitLine({
  data,
  peak,
}: {
  data: Array<{ m: string; v: number }>
  peak: number
}) {
  return (
    <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-5 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
      <div className="text-[14px] font-extrabold text-textPrimary">Gross Profit</div>
      <div className="mt-4 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ left: 6, right: 10, top: 10, bottom: 0 }}>
            <CartesianGrid stroke="rgba(145,150,168,0.22)" strokeDasharray="4 6" vertical={false} />
            <XAxis dataKey="m" tick={{ fill: '#9196A8', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[0, 24]}
              ticks={[0, 6, 12, 18, 24]}
              tickFormatter={(v) => formatM(Number(v))}
              tick={{ fill: '#9196A8', fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(124,58,237,0.25)', strokeWidth: 1 }}
              contentStyle={{
                borderRadius: 14,
                border: '1px solid rgba(145,150,168,0.22)',
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 18px 40px rgba(26,29,46,0.12)',
                color: '#1A1D2E',
                fontWeight: 700,
              }}
              formatter={(v: unknown) => {
                const n = typeof v === 'number' ? v : Number(v)
                return [`${Number.isFinite(n) ? n : String(v)}M`, 'Gross Profit']
              }}
            />
            <Line
              type="monotone"
              dataKey="v"
              stroke="#5B21B6"
              strokeWidth={3}
              dot={(p) => <GrossProfitDot {...p} peak={peak} />}
              activeDot={(p) => <GrossProfitDot {...p} peak={peak} />}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function GrossProfitDot({
  cx,
  cy,
  value,
  peak,
}: {
  cx?: number
  cy?: number
  value?: number
  peak: number
}) {
  if (typeof cx !== 'number' || typeof cy !== 'number') return null
  const isPeak = value === peak
  if (isPeak) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={10} fill="rgba(245,180,0,0.18)" />
        <circle cx={cx} cy={cy} r={6} fill="#F5B400" />
        <circle cx={cx} cy={cy} r={12} fill="none" stroke="rgba(245,180,0,0.35)" strokeWidth={2} />
      </g>
    )
  }
  return <circle cx={cx} cy={cy} r={4} fill="#F5B400" />
}

function IncomeExpensesBar({
  data,
}: {
  data: Array<{ m: string; income: number; expenses: number }>
}) {
  return (
    <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-5 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-extrabold text-textPrimary">Income & Expenses</div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-purple" />
            <span className="text-[11px] font-semibold text-textSecondary">Income</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-lavender" />
            <span className="text-[11px] font-semibold text-textSecondary">Expenses</span>
          </div>
        </div>
      </div>
      <div className="mt-4 h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: 6, right: 10, top: 10, bottom: 0 }} barSize={12}>
            <defs>
              <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7C3AED" />
                <stop offset="100%" stopColor="#5B21B6" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(145,150,168,0.18)" strokeDasharray="4 6" vertical={false} />
            <XAxis dataKey="m" tick={{ fill: '#9196A8', fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
            <YAxis
              domain={[0, 380]}
              ticks={[0, 95, 190, 285, 380]}
              tick={{ fill: '#9196A8', fontSize: 11, fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
              width={38}
            />
            <Tooltip
              cursor={{ fill: 'rgba(124,58,237,0.08)' }}
              contentStyle={{
                borderRadius: 14,
                border: '1px solid rgba(145,150,168,0.22)',
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 18px 40px rgba(26,29,46,0.12)',
                color: '#1A1D2E',
                fontWeight: 700,
              }}
              formatter={(v: unknown, name: unknown) => [String(v), String(name).toUpperCase()]}
            />
            <Bar dataKey="income" fill="url(#incomeGrad)" radius={[10, 10, 4, 4]} />
            <Bar dataKey="expenses" fill="#C4B5FD" radius={[10, 10, 4, 4]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function CapitalAllocation() {
  const data = [
    { name: 'Gold', value: 70, fill: '#F5B400' },
    { name: 'Teal', value: 30, fill: '#0FA79D' },
  ]
  return (
    <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-5 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
      <div className="text-[14px] font-extrabold text-textPrimary mb-3">Capital Allocation</div>
      <div className="h-[170px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={58}
              outerRadius={76}
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill="#1A1D2E" fontSize="28" fontWeight="900">
              38%
            </text>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-[#FFF6D6] p-3 text-center">
          <div className="text-[10px] tracking-[0.18em] font-extrabold text-[#A77A00] uppercase">CAPEX</div>
          <div className="mt-1 text-[18px] font-extrabold text-textPrimary">Rp 51,3M</div>
        </div>
        <div className="rounded-2xl bg-[#DDFBF7] p-3 text-center">
          <div className="text-[10px] tracking-[0.18em] font-extrabold text-[#0D8C83] uppercase">OPEX</div>
          <div className="mt-1 text-[18px] font-extrabold text-textPrimary">Rp 32,0M</div>
        </div>
      </div>
    </div>
  )
}

function OpExRow({
  label,
  pct,
  amount,
  color,
}: {
  label: string
  pct: number
  amount: string
  color: string
}) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-[13px] font-semibold text-textPrimary truncate">{label}</div>
        <div className="flex items-center gap-3">
          <div className="text-[12px] font-semibold text-textSecondary">{pct}%</div>
          <div className="text-[13px] font-extrabold text-textPrimary">{amount}</div>
        </div>
      </div>
      <div className="mt-2 h-[6px] w-full rounded-full bg-[rgba(145,150,168,0.20)] overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function ProfitsLossDashboardPage() {
  const [year, setYear] = useState<YearKey>('2019')

  const grossProfit = useMemo(() => {
    const base = year === '2019' ? [8, 12, 6, 15, 11, 18, 14, 20, 17, 19, 16, 22] : [7, 11, 6, 13, 10, 16, 12, 18, 15, 17, 14, 19]
    return months.map((m, i) => ({ m, v: base[i] }))
  }, [year])

  const peak = useMemo(() => Math.max(...grossProfit.map((d) => d.v)), [grossProfit])

  const incomeExpenses = useMemo(() => {
    const income = year === '2019' ? [180, 210, 195, 240, 230, 280, 270, 310, 305, 330, 320, 360] : [160, 180, 175, 210, 200, 230, 225, 255, 260, 275, 285, 300]
    const expenses = year === '2019' ? [95, 110, 105, 135, 125, 150, 145, 170, 165, 185, 180, 195] : [85, 95, 92, 115, 110, 130, 125, 145, 150, 160, 165, 175]
    return months.map((m, i) => ({ m, income: income[i], expenses: expenses[i] }))
  }, [year])

  return (
    <div className="min-h-screen bg-bg px-6 py-7">
      <div className="mx-auto max-w-[1280px] rounded-[26px] bg-card shadow-[0_30px_70px_rgba(26,29,46,0.12)]">
        <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-[rgba(145,150,168,0.16)]">
          <WaveLogo />
          <div className="flex items-center gap-3">
            <div className="text-[12px] font-semibold text-textSecondary">
              Last Update: <span className="text-textPrimary font-extrabold">28 April 2019</span>
            </div>
            <button type="button" className="h-9 rounded-xl px-4 text-[12px] font-extrabold text-white bg-purple shadow-[0_14px_30px_rgba(124,58,237,0.25)]">
              FOTO
            </button>
          </div>
        </div>

        <div className="px-6 py-6 flex gap-5">
          <div className="w-[190px] shrink-0 flex flex-col gap-4">
            <YearSelector value={year} onChange={setYear} />
            <CompanyCard />
            <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-4 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
              <div className="text-[12px] font-extrabold text-textPrimary">Expenses vs Income</div>
              <div className="mt-4 grid gap-4">
                <DonutRow title="Expenses" percent={14} value="38,0M" color="#7C3AED" />
                <DonutRow title="Income" percent={86} value="236,8M" color="#0FA79D" />
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-5">
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                title="Net Revenue"
                value="Rp 303,6M"
                delta="↘ -18,47%"
                from="#7C3AED"
                to="#4C1D95"
              />
              <StatCard
                title="Debts"
                value="Rp 8,3M"
                delta="↘ -15,86%"
                from="#FFC72C"
                to="#F5B400"
              />
              <StatCard
                title="Corporation Tax"
                value="16%"
                sub="Rp 66,88M"
                from="#0FA79D"
                to="#0D8C83"
              />
            </div>

            <GrossProfitLine data={grossProfit} peak={peak} />
            <IncomeExpensesBar data={incomeExpenses} />
          </div>

          <div className="w-[200px] shrink-0 flex flex-col gap-4">
            <CapitalAllocation />
            <div className="rounded-2xl bg-card border border-[rgba(145,150,168,0.18)] p-5 shadow-[0_18px_40px_rgba(26,29,46,0.06)]">
              <div className="text-[14px] font-extrabold text-textPrimary mb-2">Operating Expenses</div>
              <div className="divide-y divide-[rgba(145,150,168,0.14)]">
                <OpExRow label="Advertising" pct={34} amount="21,4M" color="#7C3AED" />
                <OpExRow label="Employees Cost" pct={29} amount="18,2M" color="#F5B400" />
                <OpExRow label="Office Space" pct={12} amount="7,6M" color="#0FA79D" />
                <OpExRow label="Equipment" pct={10} amount="6,1M" color="#A78BFA" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
