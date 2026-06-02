{% macro warehouse_materialization(default_materialization='materialized_view') %}
  {% if target.type == 'duckdb' %}
    {{ return('table') }}
  {% else %}
    {{ return(default_materialization) }}
  {% endif %}
{% endmacro %}

{% macro warehouse_indexes(indexes) %}
  {% if target.type == 'duckdb' %}
    {{ return([]) }}
  {% else %}
    {{ return(indexes) }}
  {% endif %}
{% endmacro %}

{% macro date_cast(expression) %}
  cast({{ expression }} as date)
{% endmacro %}

{% macro current_timestamp_compat() %}
  {% if target.type == 'duckdb' %}
    current_timestamp
  {% else %}
    now()
  {% endif %}
{% endmacro %}

{% macro datediff_hours(start_expression, end_expression) %}
  {% if target.type == 'duckdb' %}
    date_diff('second', {{ start_expression }}, {{ end_expression }}) / 3600.0
  {% else %}
    extract(epoch from ({{ end_expression }} - {{ start_expression }})) / 3600.0
  {% endif %}
{% endmacro %}

{% macro date_trunc_compat(part, expression) %}
  date_trunc('{{ part }}', {{ expression }})
{% endmacro %}
