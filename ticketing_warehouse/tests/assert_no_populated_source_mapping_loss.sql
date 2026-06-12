select *
from {{ ref('v_mapping_quality') }}
where mapping_failure_count > 0
