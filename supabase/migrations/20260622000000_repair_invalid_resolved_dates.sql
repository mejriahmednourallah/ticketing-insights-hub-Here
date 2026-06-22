update public.redmine_issues
set
  resolved_on = case
    when closed_on is not null
     and created_on is not null
     and extract(year from closed_on) >= 2000
     and closed_on >= created_on
    then closed_on
    else null
  end,
  updated_at = now()
where resolved_on is not null
  and (
    extract(year from resolved_on) < 2000
    or (created_on is not null and resolved_on < created_on)
  );
