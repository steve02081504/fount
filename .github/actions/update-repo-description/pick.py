#!/usr/bin/env python3
"""Pick a repo description from JSON5 config (gregorian / lunar / jieqi / yearday)."""

from __future__ import annotations

import os
import random
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

import json5
import sxtwl

# sxtwl jieqi index order (寿星天文历)
JIEQI = (
	'冬至', '小寒', '大寒', '立春', '雨水', '惊蛰',
	'春分', '清明', '谷雨', '立夏', '小满', '芒种',
	'夏至', '小暑', '大暑', '立秋', '处暑', '白露',
	'秋分', '寒露', '霜降', '立冬', '小雪', '大雪',
)


def solar_day(today: date):
	return sxtwl.fromSolar(today.year, today.month, today.day)


def lunar_md(today: date) -> str | None:
	"""Lunar MM-DD for non-leap months; leap months do not match festivals."""
	day = solar_day(today)
	if day.isLunarLeap():
		return None
	return f'{day.getLunarMonth():02d}-{day.getLunarDay():02d}'


def jieqi_name(today: date) -> str | None:
	day = solar_day(today)
	if not day.hasJieQi():
		return None
	return JIEQI[day.getJieQi()]


def holiday_matches(holiday: dict, today: date) -> bool:
	md = today.strftime('%m-%d')
	iso = today.isoformat()
	if any(d in (md, iso) for d in holiday.get('dates') or ()):
		return True
	lunar_dates = holiday.get('lunar') or ()
	if lunar_dates:
		lmd = lunar_md(today)
		if lmd and lmd in lunar_dates:
			return True
	terms = holiday.get('jieqi') or ()
	if terms:
		jq = jieqi_name(today)
		if jq and jq in terms:
			return True
	yearday = holiday.get('yearday')
	if yearday is not None and today.timetuple().tm_yday == yearday:
		return True
	return False


def match_holiday(config: dict, today: date) -> dict | None:
	for holiday in config.get('holidays') or ():
		if holiday_matches(holiday, today):
			return holiday
	return None


def pick_pool(config: dict, today: date) -> tuple[list[str], str | None]:
	holiday = match_holiday(config, today)
	if holiday:
		return list(holiday.get('descriptions') or ()), holiday.get('name') or 'holiday'
	core = list(config.get('core') or ())
	extras = config.get('extras')
	if not isinstance(extras, list):
		extras = list(config.get('descriptions') or ())
	else:
		extras = list(extras)
	if core and extras:
		pool = core if random.random() < 0.7 else extras
	elif core:
		pool = core
	else:
		pool = extras
	return pool, None


def resolve_today(timezone: str, date_override: str) -> date:
	if date_override:
		return date.fromisoformat(date_override)
	return datetime.now(ZoneInfo(timezone)).date()


def write_github_output(description: str, holiday_name: str | None, today: date) -> None:
	path = os.environ.get('GITHUB_OUTPUT')
	if not path:
		return
	with open(path, 'a', encoding='utf-8') as f:
		f.write('description<<EOF\n')
		f.write(f'{description}\n')
		f.write('EOF\n')
		f.write(f'holiday={holiday_name or ""}\n')
		f.write(f'date={today.isoformat()}\n')


def main(argv: list[str] | None = None) -> int:
	argv = list(sys.argv[1:] if argv is None else argv)
	if len(argv) < 1:
		print('usage: pick.py <config.json> [timezone] [YYYY-MM-DD]', file=sys.stderr)
		return 2
	config_path = argv[0]
	timezone = argv[1] if len(argv) > 1 and argv[1] else 'Asia/Shanghai'
	date_override = argv[2] if len(argv) > 2 else ''

	with open(config_path, encoding='utf-8') as f:
		config = json5.load(f)

	today = resolve_today(timezone, date_override)
	pool, holiday_name = pick_pool(config, today)
	if not pool:
		print(f'No descriptions available for today ({today.isoformat()})', file=sys.stderr)
		return 1
	description = random.choice(pool)
	if len(description) > 350:
		print(f'Description exceeds 350 characters ({len(description)})', file=sys.stderr)
		return 1

	write_github_output(description, holiday_name, today)
	print(f'date={today.isoformat()}', file=sys.stderr)
	if holiday_name:
		print(f'holiday={holiday_name}', file=sys.stderr)
	print(f'description={description}', file=sys.stderr)
	return 0


if __name__ == '__main__':
	raise SystemExit(main())
