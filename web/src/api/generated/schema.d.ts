
export interface paths {
    "/api/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["meta_api_v1_meta_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/meta/regional-validation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["regional_validation_api_v1_meta_regional_validation_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["health_api_v1_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ready": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ready_api_v1_ready_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_sites_api_v1_sites_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sites/{site_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_site_api_v1_sites__site_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_stations_api_v1_stations_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stations/networks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_networks_api_v1_stations_networks_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stations/{station_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_station_api_v1_stations__station_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/landers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_landers_api_v1_landers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/landers/{lander_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_lander_api_v1_landers__lander_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ephemeris/tracks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["tracks_api_v1_ephemeris_tracks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ephemeris/tracks/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["tracks_job_api_v1_ephemeris_tracks_jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ephemeris/subpoints": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["subpoints_api_v1_ephemeris_subpoints_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ephemeris/subpoints/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["subpoints_job_api_v1_ephemeris_subpoints_jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/time/convert": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["convert_time_api_v1_time_convert_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_jobs_api_v1_jobs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_job_api_v1_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["job_events_api_v1_jobs__job_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["cancel_job_api_v1_jobs__job_id__cancel_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/jobs/{job_id}/result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["job_result_api_v1_jobs__job_id__result_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios/validate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["validate_api_v1_scenarios_validate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_scenarios_api_v1_scenarios_get"];
        put?: never;
        post: operations["create_api_v1_scenarios_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios/{scenario_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["read_api_v1_scenarios__scenario_id__get"];
        put: operations["update_api_v1_scenarios__scenario_id__put"];
        post?: never;
        delete: operations["delete_api_v1_scenarios__scenario_id__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios/{scenario_id}/revisions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["revisions_api_v1_scenarios__scenario_id__revisions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/scenarios/{scenario_id}/revisions/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["revision_api_v1_scenarios__scenario_id__revisions__version__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["access_api_v1_agent_access_get"];
        put?: never;
        post: operations["unlock_api_v1_agent_access_post"];
        delete: operations["lock_api_v1_agent_access_delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/instructions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["instructions_api_v1_agent_instructions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/event-schema": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["schema_api_v1_agent_event_schema_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_runs_api_v1_agent_runs_get"];
        put?: never;
        post: operations["start_run_api_v1_agent_runs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_run_api_v1_agent_runs__run_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["send_message_api_v1_agent_runs__run_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/interrupt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["interrupt_api_v1_agent_runs__run_id__interrupt_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/close": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["close_run_api_v1_agent_runs__run_id__close_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["events_api_v1_agent_runs__run_id__events_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/ledger": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ledger_api_v1_agent_runs__run_id__ledger_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/ledger/{ledger_id}/result": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["ledger_entry_result_api_v1_agent_runs__run_id__ledger__ledger_id__result_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/assumptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["assumptions_api_v1_agent_runs__run_id__assumptions_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/assumptions/{assumption_id}/signoff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["signoff_api_v1_agent_runs__run_id__assumptions__assumption_id__signoff_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/inbox": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["inbox_api_v1_agent_runs__run_id__inbox_get"];
        put?: never;
        post: operations["upload_inbox_api_v1_agent_runs__run_id__inbox_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/artifacts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["artifacts_api_v1_agent_runs__run_id__artifacts_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/agent/runs/{run_id}/artifacts/{artifact_id}/content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["artifact_content_api_v1_agent_runs__run_id__artifacts__artifact_id__content_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_evidence_api_v1_evidence_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence/assets/{path}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["evidence_asset_api_v1_evidence_assets__path__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/evidence/{doc_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["evidence_doc_api_v1_evidence__doc_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/stores": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_stores_api_v1_terrain_stores_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/tilesets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["list_tilesets_api_v1_terrain_tilesets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/tiles/{tileset}/{layer}/{z}/{x}/{y}.png": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_tile_api_v1_terrain_tiles__tileset___layer___z___x___y__png_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/point": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_point_api_v1_terrain_point_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/points": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["post_points_api_v1_terrain_points_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/patch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_patch_api_v1_terrain_patch_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terrain/patch/header": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["get_patch_header_api_v1_terrain_patch_header_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["profiles_api_v1_profiles_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/constraints/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["constraint_presets_api_v1_constraints_presets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/networks/presets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["network_presets_api_v1_networks_presets_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/schemas/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["schema_api_v1_schemas__name__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/evaluate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["evaluate_api_v1_analyses_evaluate_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/scan": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["scan_api_v1_analyses_scan_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/slip": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["slip_api_v1_analyses_slip_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/sensitivity/height": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["height_sensitivity_api_v1_analyses_sensitivity_height_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/sensitivity/position": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["position_sensitivity_api_v1_analyses_sensitivity_position_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/attribution": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["attribution_api_v1_analyses_attribution_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/ellipse": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["ellipse_api_v1_analyses_ellipse_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["search_api_v1_analyses_search_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/regional": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["regional_api_v1_analyses_regional_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analyses/compare": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["compare_api_v1_analyses_compare_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/horizon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["horizon_api_v1_horizon_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exports/{kind}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["export_api_v1_exports__kind__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/report": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["report_api_v1_report_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exports/files/{digest}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["delete_export_files_api_v1_exports_files__digest__delete"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exports/files/{digest}/{name}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["export_file_api_v1_exports_files__digest___name__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AccessCode: {
            code: string;
        };
        AccessState: {
            required: boolean;
            granted: boolean;
        };
        AltSite: {
            name: string;
            lat_deg: number;
            lon_deg: number;
        };
        AssumptionItem: {
            assumption_id: string;
            ts: string;
            statement: string;
            basis: string;
            impact: string;
            needs_signoff: boolean;
            status: "accepted" | "rejected" | "pending" | "not_required";
            signoffs: components["schemas"]["SignoffRecord"][];
            used_by: string[];
        };
        AssumptionList: {
            assumptions: components["schemas"]["AssumptionItem"][];
            chain: components["schemas"]["ChainStatus"];
        };
        AttitudeSpec: {
            yaw_deg?: number | null;
            yaw_uncertainty_deg: number;
            yaw_samples: number;
            tilt_deg: number;
            tilt_az_deg: number;
        };
        AttributionRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            kind?: ("sunset" | "sunrise" | "earthset" | "earthrise") | null;
            from_utc?: string | null;
            window_h: number;
            az_deg?: number | null;
            observer: "array" | "antenna";
        };
        AttributionResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "attribution";
            event_kind: string | null;
            from_utc: string | null;
            limits: components["schemas"]["LimitNote"][];
            event?: components["schemas"]["EventAttribution"] | null;
            message?: string | null;
            azimuth?: components["schemas"]["AzimuthAttribution"] | null;
        };
        AzimuthAttribution: {
            az_deg: number;
            requested_az_deg: number;
            observer: "array" | "antenna";
            observer_height_m: number;
            horizon_elev_deg: number;
            blocker_dist_m: number | null;
            blocker: {
                [key: string]: number;
            } | null;
        };
        BatterySpec: {
            capacity_wh: number;
            charge_efficiency: number;
            discharge_efficiency: number;
            max_dod: number;
            initial_soc: number;
        };
        BoundEvent: {
            kind: string;
            role: string;
            worlds: components["schemas"]["WorldEvent"][];
            contribution_h: number | null;
            share: number | null;
        };
        BracketCoverage: {
            coverage: number;
            misses: number;
            cells: number;
            calibration_target: number;
        };
        Calendar: {
            bin_h: number;
            keys: string[];
            lunations: components["schemas"]["Lunation"][];
            state: (number | null)[][];
            open_fraction: (number | null)[][];
            limiting: (number | null)[][];
            local_solar_time_h: (number | null)[][];
            sun_el_deg: (number | null)[][];
            legend: string;
        };
        CancelReply: {
            id: string;
            kind: string;
            label: string;
            state: "queued" | "running" | "done" | "failed" | "cancelled";
            progress: number | null;
            stage: string;
            created_ms: number;
            started_ms: number | null;
            finished_ms: number | null;
            cached: boolean;
            cancel_requested: boolean;
            holders: number;
            error: {
                [key: string]: string;
            } | null;
            result_bytes: number | null;
            cache_key: string;
            job_class: "short" | "long";
            queue: components["schemas"]["QueueInfo"] | null;
            effect: "cancelled" | "requested" | "detached" | "already_finished";
            still_wanted_by: number;
            detail: string;
        };
        Candidates: {
            n_candidates: number;
            n_returned: number;
            decimated: boolean;
            et: (number | null)[];
            utc: (string | null)[];
            t_ms: (number | null)[];
            state: number[];
            worst_margin: (number | null)[];
            worst_margin_physical: (number | null)[];
            margin_unit: (string | null)[];
            margin_kind: (("worst_case" | "nominal" | "best_case") | null)[];
            margin_note: (string | null)[];
            margin_scales: {
                [key: string]: components["schemas"]["MarginScale"];
            };
            limiting: (string | null)[];
            local_solar_time_h: (number | null)[];
            sun_el_deg: (number | null)[];
            values: {
                [key: string]: (number | null)[];
            };
            values_optimistic: {
                [key: string]: (number | null)[];
            };
            values_pessimistic: {
                [key: string]: (number | null)[];
            };
            totals?: {
                [key: string]: (number | null)[];
            };
        };
        ChainStatus: {
            ok: boolean;
            problems: string[];
        };
        CompareMetric: {
            key: string;
            label: string;
            unit: string;
            values: (number | null)[];
            low: (number | null)[];
            high: (number | null)[];
            when: {
                [key: string]: components["schemas"]["MetricInstant"] | null;
            }[];
        };
        CompareRequest: {
            items: components["schemas"]["ScenarioRef"][];
            names?: string[] | null;
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        CompareResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            kind: "compare";
            names: string[];
            limits: components["schemas"]["LimitNote"][];
            metrics: components["schemas"]["CompareMetric"][];
            scenarios: components["schemas"]["CompareScenario"][];
        };
        CompareScenario: {
            name: string;
            state: string;
            limiting: string | null;
            verdict: components["schemas"]["Verdict"];
            scenario_sha256: string | null;
            landing_utc: string | null;
            site: {
                [key: string]: unknown;
            };
        };
        Confidence: "high" | "medium" | "low" | "unverified";
        ConstraintBound: {
            key: string;
            label: string;
            unit: string;
            value: number | null;
            value_range: number[] | null;
            margin: number | null;
            margin_worst: number | null;
            interval_kind: string;
            interval_hours: {
                [key: string]: number;
            };
            same_interval: boolean;
            spread_h: number;
            decomposable: boolean;
            decomposition_note: string;
            explained_quantity: string;
            world_soc: {
                [key: string]: number | null;
            } | null;
            world_soc_note: string;
            events: components["schemas"]["BoundEvent"][];
            cause: string;
            contributions: {
                [key: string]: number[] | null;
            } | null;
            note: string;
        };
        ConstraintPresetEntry: {
            name: string;
            description: string;
            constraints: components["schemas"]["Constraints"];
        };
        ConstraintPresetsResponse: {
            presets: components["schemas"]["ConstraintPresetEntry"][];
        };
        ConstraintVerdict: {
            key: string;
            label: string;
            state: string;
            value: number | null;
            value_range: number[] | null;
            limit_min: number | null;
            limit_max: number | null;
            unit: string;
            margin: number | null;
            margin_worst: number | null;
            censored: boolean;
            origin_basis: string;
            origin_label: string;
            origin_source_url: string | null;
            heading_dependent: boolean;
            heading_note: string;
            value_worlds: {
                [key: string]: number | null;
            };
            margin_worlds: {
                [key: string]: number | null;
            };
            margin_limits: {
                [key: string]: ("min" | "max") | null;
            };
            worst_world: ("nominal" | "optimistic" | "pessimistic") | null;
            worst_limit: ("min" | "max") | null;
            heading_best: components["schemas"]["HeadingBest"] | null;
            heading_worst: components["schemas"]["HeadingWorst"] | null;
            heading_basis: string;
            case_basis: "horizon" | "heading";
        };
        Constraints: {
            landing_sun_elevation_deg?: components["schemas"]["Limit"] | null;
            landing_hours_after_sunrise?: components["schemas"]["Limit"] | null;
            dte_at_landing_deg?: components["schemas"]["Limit"] | null;
            min_sunlit_hours_after_landing?: components["schemas"]["Limit"] | null;
            max_dark_span_h?: components["schemas"]["Limit"] | null;
            min_total_sunlit_h?: components["schemas"]["Limit"] | null;
            min_state_of_charge?: components["schemas"]["Limit"] | null;
            min_contact_fraction?: components["schemas"]["Limit"] | null;
            max_contact_gap_h?: components["schemas"]["Limit"] | null;
            min_total_contact_h?: components["schemas"]["Limit"] | null;
            min_total_sunlit_contact_h?: components["schemas"]["Limit"] | null;
            min_link_margin_db?: components["schemas"]["Limit"] | null;
            max_slope_deg?: components["schemas"]["Limit"] | null;
            sunlit_flux_fraction: components["schemas"]["Parameter"];
            antenna_terrain_margin_deg: components["schemas"]["Parameter"];
            slope_baseline_m: components["schemas"]["Parameter"];
        };
        EclipseSettings: {
            shadow: "danjon" | "geometric";
            earth_radius_km?: number | null;
            atmosphere_km: number;
            origin: components["schemas"]["Origin"];
        };
        Ellipse: {
            semi_major_m: number;
            semi_minor_m: number;
            azimuth_deg: number;
            dispersion: "gaussian" | "uniform";
            sigma_level: number;
            origin: components["schemas"]["Origin"];
        };
        EllipseMapGrid: {
            spacing_m: number;
            east_m: number[][];
            north_m: number[][];
            state: number[][];
            worst_margin: (number | null)[][];
        };
        EllipseParams: {
            n_samples: number;
            seed: number;
            truncate: boolean;
            hazard_slope_deg?: number | null;
            hazard_roughness_m?: number | null;
            map_cells: number | null;
            convergence_tolerance: number;
            with_samples: boolean;
        };
        EllipseRequest: {
            n_samples: number;
            seed: number;
            truncate: boolean;
            hazard_slope_deg?: number | null;
            hazard_roughness_m?: number | null;
            map_cells: number | null;
            convergence_tolerance: number;
            with_samples: boolean;
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        EllipseResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "ellipse";
            limits: components["schemas"]["LimitNote"][];
            scenario_name: string;
            n_samples: number;
            seed: number;
            scheme: string;
            truncated_to_ellipse: boolean;
            keys: string[];
            state_probability: {
                [key: string]: number | null;
            };
            state_probability_non_hazardous: {
                [key: string]: number | null;
            };
            hazard_fraction: number | null;
            hazard_limits: {
                [key: string]: number | null;
            };
            hazard_origins: {
                [key: string]: components["schemas"]["HazardOrigin"];
            };
            closing_constraints: {
                [key: string]: number;
            };
            closing_fraction: {
                [key: string]: number | null;
            };
            constraint_probability: {
                [key: string]: {
                    [key: string]: number | null;
                };
            };
            percentiles: {
                [key: string]: {
                    [key: string]: number | null;
                };
            };
            best: components["schemas"]["SampleRef"];
            worst: components["schemas"]["SampleRef"];
            centre: components["schemas"]["SampleRef"];
            convergence: {
                [key: string]: unknown;
            };
            map: components["schemas"]["EllipseMapGrid"] | null;
            samples?: {
                [key: string]: unknown;
            } | null;
        };
        EvaluateRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            from_utc?: string | null;
            max_points: number;
            window: "mission" | "all";
            with_bounds: boolean;
        };
        EvaluateResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "evaluate";
            limits: components["schemas"]["LimitNote"][];
            landing: components["schemas"]["Landing"];
            verdict: components["schemas"]["Verdict"];
            explanations: components["schemas"]["Explanation"][];
            metrics: components["schemas"]["Metric"][];
            intervals: {
                [key: string]: components["schemas"]["Interval"][];
            };
            next_events_from_utc: string | null;
            next_events: {
                [key: string]: components["schemas"]["NextEvent"] | null;
            };
            slope_deg: number | null;
            horizons: {
                [key: string]: components["schemas"]["HorizonCurve"];
            };
            series_meta: components["schemas"]["SeriesMeta"];
            series: components["schemas"]["Series"];
            heading: components["schemas"]["HeadingResult"] | null;
            bounds: components["schemas"]["ConstraintBound"][] | null;
        };
        EventAttribution: {
            kind: string;
            et: number;
            utc: string;
            az_deg: number;
            horizon_elev_deg: number;
            object_elev_deg: number;
            blocker_dist_m: number | null;
            blocker: {
                [key: string]: number;
            } | null;
            cause: string;
            station: string | null;
            limiting_side: string | null;
            detail: string;
            time_basis: string;
            eclipse_fraction: number;
            limb_crossing: boolean;
        };
        EvidenceDoc: {
            id: string;
            title: string;
            path: string;
            kind: "validation" | "research";
            modified_utc: string;
            size_bytes: number;
        };
        Explanation: {
            key: string;
            text: string;
        };
        ExportFile: {
            name: string;
            media_type: string;
            size_bytes: number;
            sha256: string;
            url: string;
        };
        ExportManifest: {
            kind: string;
            files: components["schemas"]["ExportFile"][];
            provenance: {
                [key: string]: unknown;
            };
        };
        ExportRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            aem_horizon: "antenna" | "array";
            aem_bound: "nominal" | "optimistic" | "pessimistic";
            max_points?: number | null;
            window: "mission" | "all";
            scan?: components["schemas"]["ScanParams"] | null;
            slip?: components["schemas"]["SlipParams"] | null;
            compare_with?: components["schemas"]["ScenarioRef"][];
        };
        GeoJsonPolygon: {
            type: "Polygon";
            coordinates: number[][][];
        };
        HTTPValidationError: {
            detail?: components["schemas"]["ValidationError"][];
        };
        HazardOrigin: {
            origin: "request" | "scenario_constraint" | "none";
            label: string | null;
            basis: string | null;
            source_url: string | null;
        };
        HeadingBest: {
            yaw_deg: number;
            value: number;
            horizon: "nominal";
        };
        HeadingConstraint: {
            key: string;
            unit: string;
            limit_min: number | null;
            values_by_heading: (number | null)[];
            passing_deg: number[][];
            all_pass: boolean;
            none_pass: boolean;
        };
        HeadingResult: {
            known: boolean;
            nominal_yaw_deg: number | null;
            nominal_basis: string;
            uncertainty_deg: number;
            depends: boolean;
            yaws_deg: number[];
            best_yaw_deg: number | null;
            worst_yaw_deg: number | null;
            worst_arc_deg: number[][];
            constraints: components["schemas"]["HeadingConstraint"][];
            soc_min_total: number[] | null;
            soc_min_heading_only: number[] | null;
            soc_min_horizon_only: number[] | null;
            soc_min_by_heading: number[];
            cause: string;
        };
        HeadingWorst: {
            yaw_deg: number;
            arcs_deg: number[][];
            value: number;
            horizon: "nominal";
        };
        HealthResponse: {
            status: "ok";
            warm: boolean;
            pool: components["schemas"]["PoolState"];
        };
        HeightSensitivityRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            kind: "array" | "antenna";
            heights_m: number[];
        };
        HorizonCurve: {
            height_m: number;
            ground_height_m: number | null;
            az_deg: (number | null)[];
            elev_deg: (number | null)[];
            elev_lo_deg: (number | null)[];
            elev_hi_deg: (number | null)[];
            blocker_dist_m: (number | null)[];
        };
        HorizonPeak: {
            az_deg: number;
            elev_deg: number;
            blocker_dist_m: number | null;
            blocker: {
                [key: string]: number;
            } | null;
        };
        HorizonRequest: {
            lat_deg: number;
            lon_deg: number;
            height_m: number;
            antenna_height_max_m?: number | null;
            terrain: "auto" | "on" | "off";
            n_az: number;
            wait_s: number;
            apply_error_model: boolean;
            terrain_stores?: string[] | null;
            terrain_error?: components["schemas"]["TerrainErrorSettings"] | null;
        };
        HorizonResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            kind: "horizon";
            limits: components["schemas"]["LimitNote"][];
            site: components["schemas"]["HorizonSite"];
            ground_height_m: number | null;
            n_az: number;
            az_deg: (number | null)[];
            elev_deg: (number | null)[];
            elev_lo_deg: (number | null)[];
            elev_hi_deg: (number | null)[];
            blocker_dist_m: (number | null)[];
            max_elev_deg: number;
            max_elev_az_deg: number;
            sphere_dip_deg: number;
            peaks: components["schemas"]["HorizonPeak"][];
        };
        HorizonSite: {
            lat_deg: number;
            lon_deg: number;
            height_m: number;
        };
        InboxEntry: {
            name: string;
            path: string;
            size_bytes: number;
            sha256: string;
            source_name?: string | null;
        };
        InboxList: {
            files: components["schemas"]["InboxEntry"][];
        };
        Instructions: {
            model: string;
            default_model: string;
            prompt_version: string;
            prompt_sha256: string;
            prompt_template_sha256: string;
            instructions: string;
            tools: {
                [key: string]: unknown;
            }[];
            permission_policy: {
                [key: string]: unknown;
            };
            sandbox: {
                [key: string]: unknown;
            };
            versions: {
                [key: string]: string;
            };
            workspace: string;
            max_budget_usd: number | null;
        };
        Interval: {
            start_worlds: string[] | null;
            end_worlds: string[] | null;
            start_utc: string | null;
            end_utc: string | null;
            duration_h: number | null;
            start_range_utc: (string | null)[];
            end_range_utc: (string | null)[];
            start_censored: boolean;
            end_censored: boolean;
            start_range_censored: boolean;
            end_range_censored: boolean;
            nominal: boolean;
            certain: boolean;
        };
        JobResult: components["schemas"]["EvaluateResult"] | components["schemas"]["ScanResult"] | components["schemas"]["SlipResult"] | components["schemas"]["SensitivityResult"] | components["schemas"]["AttributionResult"] | components["schemas"]["CompareResult"] | components["schemas"]["HorizonResult"] | components["schemas"]["EllipseResult"] | components["schemas"]["SearchResult"] | components["schemas"]["RegionalResult"] | components["schemas"]["ExportManifest"];
        JobStatus: {
            id: string;
            kind: string;
            label: string;
            state: "queued" | "running" | "done" | "failed" | "cancelled";
            progress: number | null;
            stage: string;
            created_ms: number;
            started_ms: number | null;
            finished_ms: number | null;
            cached: boolean;
            cancel_requested: boolean;
            holders: number;
            error: {
                [key: string]: string;
            } | null;
            result_bytes: number | null;
            cache_key: string;
            job_class: "short" | "long";
            queue: components["schemas"]["QueueInfo"] | null;
        };
        KernelInfo: {
            name: string;
            sha256: string;
            size_bytes: number;
            role: string;
            url?: string | null;
            coverage_utc?: [
                string,
                string
            ] | null;
        };
        KernelSetInfo: {
            available: boolean;
            error?: string | null;
            valid_utc?: [
                string,
                string
            ] | null;
            files: components["schemas"]["KernelInfo"][];
        };
        LanderEntry: {
            id: string;
            name: string;
            confidence: components["schemas"]["Confidence"];
            sources: components["schemas"]["Source"][];
            notes: string;
            operator: string;
            country: string;
            status: "flown" | "in_development" | "retired" | "cancelled";
            missions: string[];
            params: {
                [key: string]: components["schemas"]["Quantity"];
            };
        };
        LanderPage: {
            total: number;
            items: components["schemas"]["LanderEntry"][];
        };
        LanderProfile: {
            schema_version: string;
            id: string;
            name: string;
            description: string;
            array_height_m: number;
            antenna_height_m: number;
            antenna_height_max_m?: number | null;
            panels: components["schemas"]["PanelSpec"][];
            attitude: components["schemas"]["AttitudeSpec"];
            battery: components["schemas"]["BatterySpec"];
            loads: components["schemas"]["LoadSpec"];
            link?: components["schemas"]["LinkSpec"] | null;
            origins?: {
                [key: string]: components["schemas"]["Origin"];
            };
        };
        Landing: {
            utc: string | null;
            et: number;
            mission_end_utc: string | null;
            mission_h: number;
        };
        LayerDef: {
            id: "relief" | "elevation" | "slope" | "heights";
            title: string;
            description: string;
            encoding: string;
            legend: components["schemas"]["Legend"];
        };
        LedgerList: {
            entries: {
                [key: string]: unknown;
            }[];
            chain: components["schemas"]["ChainStatus"];
        };
        LedgerResult: {
            ledger_id: string;
            tool: string | null;
            kind: string;
            size_bytes: number;
            rows: {
                [key: string]: string;
            };
            row_ids: string[];
            output: unknown | null;
            skeleton: unknown | null;
            row_id: string | null;
            row: unknown[] | null;
            limit_bytes: number;
        };
        Legend: {
            type: "greyscale" | "ramp" | "terrarium";
            min?: number | null;
            max?: number | null;
            units: string;
            stops?: components["schemas"]["LegendStop"][] | null;
        } & {
            [key: string]: unknown;
        };
        LegendStop: {
            value: number;
            color: string;
        };
        Limit: {
            min?: number | null;
            max?: number | null;
            unit: string;
            label: string;
            origin: components["schemas"]["Origin"];
            margin_scale: number;
        };
        LimitNote: {
            id: string;
            title: string;
            kind: "assumed" | "not_modelled" | "model_limit" | "known_miss";
            category: string;
            text: string;
            parameters: {
                [key: string]: unknown;
            };
            source: string;
            quote: string;
            more: string[];
        };
        LinkSpec: {
            eirp_dbw: number;
            frequency_hz: number;
            data_rate_bps: number;
            required_ebn0_db: number;
            losses_db: number[];
            implementation_loss_db: number;
            required_margin_db: number;
            default_g_over_t_dbk?: number | null;
        };
        LoadSpec: {
            sunlit_w: number;
            dark_w: number;
        };
        Lunation: {
            number: number;
            start_utc: string | null;
            end_utc: string | null;
        };
        MapBBox: {
            xmin: number;
            xmax: number;
            ymin: number;
            ymax: number;
            units: "m" | "deg";
        };
        MarginScale: {
            unit: string;
            margin_scale: number;
        };
        MatrixSize: {
            z: number;
            width: number;
            height: number;
        };
        MessageCreate: {
            prompt: string;
        };
        MetaResponse: {
            service_version: string;
            code_version: string;
            python_version: string;
            kernels: components["schemas"]["KernelSetInfo"];
            terrain_stores: components["schemas"]["TerrainStoreInfo"][];
            horizon_module_available: boolean;
            scenario_module_available: boolean;
            agent_enabled: boolean;
            job_kinds: {
                [key: string]: string;
            };
            limits: {
                [key: string]: number;
            };
            conventions: {
                [key: string]: string;
            };
        };
        Metric: {
            key: string;
            label: string;
            value: number | null;
            unit: string;
            low: number | null;
            high: number | null;
            censored: boolean;
            note: string;
            one_sided: boolean;
            when: {
                [key: string]: components["schemas"]["MetricInstant"] | null;
            };
            when_basis: string;
            when_resolution_s: number | null;
        };
        MetricInstant: {
            et: number;
            utc: string;
            value: number;
            hold_s: number;
        };
        Network: {
            stations: components["schemas"]["NetworkStation"][];
            label: string;
            direction: "downlink" | "uplink" | "two_way";
        };
        NetworkCount: {
            network: string;
            count: number;
        };
        NetworkPresetEntry: {
            id: string;
            label: string;
            description: string;
            station_ids: string[];
            network: components["schemas"]["Network"];
        };
        NetworkPresetsResponse: {
            presets: components["schemas"]["NetworkPresetEntry"][];
        };
        NetworkStation: {
            id: string;
            name: string;
            network: string;
            lat_deg: number;
            lon_deg: number;
            alt_m: number;
            alt_basis: "published" | "derived" | "unknown" | "user";
            rx_mask_deg: number;
            tx_mask_deg: number;
            g_over_t_dbk?: number | null;
            origin: components["schemas"]["Origin"];
        };
        NextEvent: {
            kind: string;
            utc: string | null;
            et: number;
            hours: number | null;
            range_utc: (string | null)[];
            missing_worlds: string[];
            one_sided: boolean;
            cause: string;
            name: string;
        };
        OpenWindow: {
            start_utc: string | null;
            end_utc: string | null;
            n_candidates: number;
            n_pass: number;
            duration_h: number;
            best_utc: string | null;
            best_margin: number | null;
            best_margin_physical: number | null;
            best_margin_unit: string | null;
            best_state: string;
            best_margin_kind: ("worst_case" | "nominal" | "best_case") | null;
            best_margin_note: string | null;
            best_limiting: string | null;
            robust: (string | null)[][];
            spacing_h: number;
            best_totals?: {
                [key: string]: number | null;
            };
        };
        Origin: {
            basis: "published" | "derived" | "estimate" | "convention" | "historical" | "mission-specific" | "user" | "model-typed" | "default" | "unknown";
            label: string;
            source_url?: string | null;
            note: string;
        };
        PanelSpec: {
            name: string;
            normal_body: [
                number,
                number,
                number
            ];
            area_m2: number;
            efficiency: number;
            tracking: boolean;
        };
        Parameter: {
            value: number;
            unit: string;
            label: string;
            origin: components["schemas"]["Origin"];
        };
        PatchCorner: {
            lat_deg: number;
            lon_deg: number;
        };
        PatchCorners: {
            nw: components["schemas"]["PatchCorner"];
            ne: components["schemas"]["PatchCorner"];
            sw: components["schemas"]["PatchCorner"];
            se: components["schemas"]["PatchCorner"];
        };
        PatchHeader: {
            format: "LNP1";
            lat_deg: number;
            lon_deg: number;
            size_m: number;
            n: number;
            spacing_m: number;
            radius_m: number;
            east_m: number[];
            north_m: number[];
            corners: components["schemas"]["PatchCorners"];
            nodata: "NaN";
            data_offset: number;
            dtype: "float32le";
            sources: components["schemas"]["PatchSource"][];
            height_range_m: number[] | null;
            n_nodata: number;
            effective_resolution_m: number | null;
            notes: string;
            curvature: string;
        } & {
            [key: string]: unknown;
        };
        PatchSource: {
            id: string;
            pixel_size_m: number;
            projection: string;
            level?: number | null;
            level_pixel_size_m?: number | null;
        };
        PointIn: {
            lat_deg: number;
            lon_deg: number;
        };
        PointResult: {
            lat_deg: number;
            lon_deg: number;
            height_m: number | null;
            slope_deg: number | null;
            aspect_deg: number | null;
            baseline_m: number;
            store_id: string | null;
            pixel_size_m: number | null;
        };
        PointsRequest: {
            points: components["schemas"]["PointIn"][];
            baseline_m: number;
        };
        PointsResponse: {
            points: components["schemas"]["PointResult"][];
        };
        PoolState: {
            state: "disabled" | "warming" | "ready" | "failed" | "stopping";
            workers: number;
            warm: number;
            seconds?: number | null;
            error?: string | null;
        };
        PositionSensitivityRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            distances_m?: number[] | null;
        };
        Problem: {
            type: string;
            title: string;
            status: number;
            detail?: string | null;
            request_id?: string | null;
            errors?: {
                [key: string]: unknown;
            }[] | null;
        } & {
            [key: string]: unknown;
        };
        ProfileEntry: {
            id: string;
            source: "catalog" | "generic";
            lander_id: string | null;
            variant: string;
            name: string;
            description: string;
            profile: components["schemas"]["LanderProfile"];
            estimates: components["schemas"]["ProfileEstimate"][];
            n_published: number;
        };
        ProfileEstimate: {
            path: string;
            basis: string;
            label: string;
            source_url?: string | null;
            note: string;
        };
        ProfilesResponse: {
            profiles: components["schemas"]["ProfileEntry"][];
            layouts: string[];
        };
        Quantity: {
            value: number | boolean | string | (number | boolean | string)[];
            unit: string;
            basis: "published" | "derived" | "estimate";
            source?: number | null;
            note: string;
        };
        QueueAhead: {
            id: string;
            kind: string;
            label: string;
            state: "running" | "queued";
        };
        QueueInfo: {
            position: number;
            waiting_for: "worker" | "long-limit";
            ahead_count: number;
            ahead: components["schemas"]["QueueAhead"][];
        };
        RankedSite: {
            rank: number;
            lat_deg: number;
            lon_deg: number;
            east_m: number;
            north_m: number;
            state: string;
            worst_margin: number | null;
            worst_margin_physical: number | null;
            margin_unit: string | null;
            margin_kind: ("worst_case" | "nominal" | "best_case") | null;
            margin_note: string | null;
            limiting: string | null;
            landing_utc: string;
            n_epochs_pass: number;
            n_epochs: number;
            slope_deg: number | null;
            roughness_m: number | null;
            values: {
                [key: string]: number | null;
            };
            constraint_state: {
                [key: string]: string;
            };
            totals?: {
                [key: string]: number | null;
            };
        };
        RegionalBracketCoverage: {
            coverage: number;
            misses: number;
            cells: number;
            calibration_target: number;
        };
        RegionalLayerInfo: {
            name: string;
            support: components["schemas"]["RegionalSupport"] | null;
            file: components["schemas"]["ExportFile"];
            dtype: string;
            n_nodata: number;
            min: number | null;
            max: number | null;
            mean: number | null;
        };
        RegionalLayerValidation: {
            layer: string;
            point_value: "supported" | "approximate" | "bracket_only";
            unit: string;
            error_unit: string;
            bracket_coverage: components["schemas"]["RegionalBracketCoverage"];
            measured_error: {
                [key: string]: unknown;
            };
        };
        RegionalLimit: {
            op: ">=" | "<=";
            value: number;
        };
        RegionalRequest: {
            lat_deg: number;
            lon_deg: number;
            size_m: number;
            spacing_m: number;
            start_utc: string;
            stop_utc: string;
            step_s: number;
            mast_height_m: number;
            sun_rule: "any_part" | "half_flux";
            earth_rule: "centre" | "any_part";
            earth_margin_deg: number;
            dem_ids?: string[] | null;
            bounds: boolean;
            calibrate: number;
            do_earth: boolean;
            limits?: {
                [key: string]: components["schemas"]["RegionalLimit"];
            } | null;
            inline?: string[];
            name: string;
            wait_s: number;
        };
        RegionalResult: {
            kind: "regional";
            warnings: string[];
            spec: {
                [key: string]: unknown;
            };
            geotransform: number[];
            layers: components["schemas"]["RegionalLayerInfo"][];
            files: components["schemas"]["ExportFile"][];
            inline: {
                [key: string]: (number | null)[][];
            };
            layer_support: {
                [key: string]: components["schemas"]["RegionalSupport"];
            };
            header: {
                [key: string]: unknown;
            };
            provenance: {
                [key: string]: unknown;
            };
        };
        RegionalSupport: {
            point_value: "supported" | "approximate" | "bracket_only" | "exact_input" | "bracket";
            unit: string | null;
            error_unit: string | null;
            role: string;
            bracket_layers: string[];
            run_measured_error: {
                [key: string]: number;
            } | null;
            run_measured_on: string | null;
            validation: components["schemas"]["RegionalValidation"] | null;
            note: string;
            bracket_of?: string | null;
            bracket_low_horizon?: ("raised" | "lowered") | null;
            bracket_high_horizon?: ("raised" | "lowered") | null;
            horizon_shift?: ("raised" | "lowered") | null;
        };
        RegionalValidation: {
            configuration: string;
            applies_to_run: boolean | null;
            bracket_coverage: components["schemas"]["BracketCoverage"];
            measured_error: {
                [key: string]: unknown;
            };
            measured_by: string;
        };
        RegionalValidationRecord: {
            document: string;
            measured_by: string;
            configuration: {
                [key: string]: unknown;
            };
            layers: components["schemas"]["RegionalLayerValidation"][];
        };
        ReportRequest: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
            format: "html" | "pdf";
            generated_utc?: string | null;
            scan?: components["schemas"]["ScanParams"] | null;
            slip?: components["schemas"]["SlipParams"] | null;
            compare_with?: components["schemas"]["ScenarioRef"][];
            ellipse?: components["schemas"]["EllipseParams"] | null;
            search?: components["schemas"]["SearchParams"] | null;
        };
        RevisionInfo: {
            version: number;
            name: string;
            saved_utc: string;
        };
        RunCreate: {
            prompt: string;
            model?: string | null;
            budget_usd?: number | null;
        };
        RunMeta: {
            run_id: string;
            state: string;
            status?: string | null;
            model: string;
            created_at?: string | null;
            updated_at?: string | null;
            turns: number;
            cost_usd?: number | null;
            budget_usd?: number | null;
            first_prompt?: string | null;
            prompt_version?: string | null;
            prompt_sha256?: string | null;
            prompt_template_sha256: string;
            session_id?: string | null;
            workspace?: string | null;
            live: boolean;
            busy: boolean;
            sandbox?: {
                [key: string]: unknown;
            } | null;
        } & {
            [key: string]: unknown;
        };
        SampleRef: {
            index: number;
            lat_deg: number;
            lon_deg: number;
            east_m: number;
            north_m: number;
            state: string;
            worst_margin: number | null;
            worst_margin_physical: number | null;
            margin_unit: string | null;
            margin_kind: ("worst_case" | "nominal" | "best_case") | null;
            margin_note: string | null;
            limiting: string | null;
            slope_deg: number | null;
            roughness_m: number | null;
        };
        Sampling: {
            step_s: number;
            lookback_h: number;
        };
        ScanParams: {
            start_utc: string;
            end_utc: string;
            spacing_s: number;
            signal_step_s: number;
            lookback_h: number;
            calendar_bin_h: number;
            rank_by: "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
            max_candidates: number;
        };
        ScanRequest: {
            start_utc: string;
            end_utc: string;
            spacing_s: number;
            signal_step_s: number;
            lookback_h: number;
            calendar_bin_h: number;
            rank_by: "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
            max_candidates: number;
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        ScanResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "scan";
            start_utc: string;
            end_utc: string;
            spacing_s: number;
            rank_by: string;
            states: {
                [key: string]: number;
            };
            counts: {
                [key: string]: number;
            };
            closing_constraints: {
                [key: string]: number;
            };
            state_fraction: {
                [key: string]: number | null;
            };
            closing_fraction: {
                [key: string]: number | null;
            };
            limits: components["schemas"]["LimitNote"][];
            windows: components["schemas"]["OpenWindow"][];
            calendar: components["schemas"]["Calendar"];
            candidates: components["schemas"]["Candidates"];
        };
        Scenario: {
            schema_version: string;
            name: string;
            site: components["schemas"]["SiteSpec"];
            landing_utc: string;
            mission_duration_h: number;
            profile: components["schemas"]["LanderProfile"];
            constraints: components["schemas"]["Constraints"];
            network: components["schemas"]["Network"];
            transfer?: components["schemas"]["Transfer"] | null;
            ellipse?: components["schemas"]["Ellipse"] | null;
            terrain_error: components["schemas"]["TerrainErrorSettings"];
            eclipse: components["schemas"]["EclipseSettings"];
            sampling: components["schemas"]["Sampling"];
            notes: string;
            terrain_stores?: string[] | null;
        };
        ScenarioCreate: {
            document: {
                [key: string]: unknown;
            };
        };
        ScenarioPage: {
            total: number;
            items: components["schemas"]["ScenarioSummary"][];
        };
        ScenarioRecord: {
            id: string;
            name: string;
            version: number;
            created_utc: string;
            updated_utc: string;
            document: components["schemas"]["Scenario"];
        };
        ScenarioRef: {
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        ScenarioSummary: {
            id: string;
            name: string;
            version: number;
            created_utc: string;
            updated_utc: string;
        };
        ScenarioUpdate: {
            expected_version: number;
            document: {
                [key: string]: unknown;
            };
        };
        ScenarioValidation: {
            ok: true;
            document: components["schemas"]["Scenario"];
        };
        SearchLevel: {
            spacing_m: number;
            n_candidates: number;
            n_slope_pruned: number;
            n_evaluated: number;
            n_promoted: number;
            horizon: string;
            seconds: number;
            capped: boolean;
        };
        SearchParams: {
            region: components["schemas"]["SearchRegionModel"];
            final_spacing_m: number;
            first_utc?: string | null;
            last_utc?: string | null;
            epoch_spacing_h?: number | null;
            coarse_factor: number;
            slack: number;
            min_promote: number;
            max_promoted: number;
            top_k: number;
            min_separation_m?: number | null;
            exhaustive: boolean;
            prune_world: "optimistic" | "nominal";
            rank_by: "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
            hazard_roughness_m?: number | null;
            with_grid: boolean;
        };
        SearchRegionModel: {
            lat_deg: number;
            lon_deg: number;
            radius_m?: number | null;
            polygon?: [
                number,
                number
            ][] | null;
        };
        SearchRequest: {
            region: components["schemas"]["SearchRegionModel"];
            final_spacing_m: number;
            first_utc?: string | null;
            last_utc?: string | null;
            epoch_spacing_h?: number | null;
            coarse_factor: number;
            slack: number;
            min_promote: number;
            max_promoted: number;
            top_k: number;
            min_separation_m?: number | null;
            exhaustive: boolean;
            prune_world: "optimistic" | "nominal";
            rank_by: "margin" | "sunlit_h" | "contact_h" | "sunlit_contact_h";
            hazard_roughness_m?: number | null;
            with_grid: boolean;
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        SearchResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "search";
            limits: components["schemas"]["LimitNote"][];
            sites: components["schemas"]["RankedSite"][];
            levels: components["schemas"]["SearchLevel"][];
            counts: {
                [key: string]: number;
            };
            settings: {
                [key: string]: unknown;
            };
            seconds: number;
            n_full_evaluations: number;
            n_exhaustive_equivalent: number;
            grid?: {
                [key: string]: unknown;
            } | null;
        };
        SensitivityResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            scenario: {
                [key: string]: unknown;
            } | null;
            kind: "sensitivity-height" | "sensitivity-position";
            limits: components["schemas"]["LimitNote"][];
            variant: string;
            baseline: components["schemas"]["SensitivityRow"];
            rows: components["schemas"]["SensitivityRow"][];
        };
        SensitivityRow: {
            label: string;
            value: number;
            az_deg: number | null;
            lat_deg: number;
            lon_deg: number;
            state: string;
            limiting: string | null;
            metrics: {
                [key: string]: number | null;
            };
            margins: {
                [key: string]: number | null;
            };
            when: {
                [key: string]: {
                    [key: string]: components["schemas"]["MetricInstant"] | null;
                };
            };
        };
        Series: {
            et: (number | null)[];
            utc: (string | null)[];
            t_ms: (number | null)[];
            sun_az_deg: (number | null)[];
            sun_el_deg: (number | null)[];
            sun_ang_radius_deg: (number | null)[];
            earth_az_deg: (number | null)[];
            earth_el_deg: (number | null)[];
            earth_range_km: (number | null)[];
            earth_ang_radius_deg: (number | null)[];
            eclipse_fraction: (number | null)[];
            sunlight_fraction: (number | null)[];
            sunlight_fraction_lo: (number | null)[];
            sunlight_fraction_hi: (number | null)[];
            array_power_w: (number | null)[];
            array_power_w_lo: (number | null)[];
            array_power_w_hi: (number | null)[];
            contact_clearance_deg: (number | null)[];
            contact_clearance_deg_lo: (number | null)[];
            contact_clearance_deg_hi: (number | null)[];
            soc: (number | null)[];
            soc_lo: (number | null)[];
            soc_hi: (number | null)[];
            link_margin_db?: (number | null)[] | null;
        } & {
            [key: string]: (number | null)[];
        };
        SeriesMeta: {
            window: "mission" | "all";
            n_window: number;
            n_returned: number;
            max_points: number;
            decimated: boolean;
            decimation: string;
        };
        SeriesProvenance: {
            kernels: {
                [key: string]: string;
            };
            code_version: string;
            frame: string;
            table_grid_step_s: number | null;
        };
        SignoffRecord: {
            decision: "accepted" | "rejected";
            who: string;
            ts: string;
            note: string;
        };
        SignoffRequest: {
            decision: "accepted" | "rejected";
            who: string;
            note: string;
        };
        SiteEntry: {
            id: string;
            name: string;
            confidence: components["schemas"]["Confidence"];
            sources: components["schemas"]["Source"][];
            notes: string;
            kind: "landed" | "impact" | "planned" | "not_landed" | "region" | "poi";
            lat_deg: number;
            lon_deg: number;
            frame_note: string;
            mission: string;
            operator: string;
            country: string;
            status: string;
            landing_utc?: string | null;
            landing_date?: string | null;
            planned_date: string;
            extent_km?: number | null;
            extent_kind?: ("side" | "diameter") | null;
        };
        SiteIn: {
            lat_deg: number;
            lon_deg: number;
            mast_height_m: number;
            ground_height_m: number;
            name: string;
        };
        SitePage: {
            total: number;
            items: components["schemas"]["SiteEntry"][];
        };
        SiteSpec: {
            lat_deg: number;
            lon_deg: number;
            name: string;
            catalog_id?: string | null;
        };
        SlipParams: {
            slips_h: number[];
            mode: "landing" | "launch";
            search_days: number;
            spacing_s: number;
            alternative_sites?: string[];
            alternative_coordinates?: components["schemas"]["AltSite"][];
        };
        SlipRequest: {
            slips_h: number[];
            mode: "landing" | "launch";
            search_days: number;
            spacing_s: number;
            alternative_sites?: string[];
            alternative_coordinates?: components["schemas"]["AltSite"][];
            scenario?: components["schemas"]["Scenario"] | null;
            scenario_id?: string | null;
            overrides?: {
                [key: string]: unknown;
            };
            terrain: "auto" | "on" | "off";
            wait_s: number;
        };
        SlipResult: {
            scenario_sha256: string | null;
            provider: string;
            warnings: string[];
            terrain_stack: components["schemas"]["TerrainStackUsed"] | null;
            provenance: {
                [key: string]: unknown;
            };
            kind: "slip";
            scenario: {
                [key: string]: unknown;
            } | null;
            mode: string;
            slips_h: number[];
            ranked: boolean;
            ranking_key: string;
            limits: components["schemas"]["LimitNote"][];
            results: components["schemas"]["SlipSiteResult"][];
        };
        SlipRow: {
            slip_h: number;
            launch_utc: string | null;
            landing_utc: string | null;
            state: string;
            limiting: string | null;
            margin: number | null;
            margin_kind: ("worst_case" | "nominal" | "best_case") | null;
            margin_note: string | null;
            verdict: components["schemas"]["Verdict"] | null;
            explanation: string;
            next_open_utc: string | null;
            next_open_wait_h: number | null;
            next_open_state: string | null;
            next_open_candidates: number | null;
            next_open_span_h: number | null;
            candidate_spacing_h: number | null;
        };
        SlipSiteResult: {
            scenario_name: string;
            site_id: string | null;
            site_name: string | null;
            site: {
                [key: string]: unknown;
            };
            mode: string;
            n_pass: number;
            n_open: number;
            mean_margin: number | null;
            scenario_sha256: string | null;
            provenance: {
                [key: string]: unknown;
            };
            rows: components["schemas"]["SlipRow"][];
        };
        Source: {
            url: string;
            title: string;
            locator: string;
        };
        StationEntry: {
            id: string;
            name: string;
            confidence: components["schemas"]["Confidence"];
            sources: components["schemas"]["Source"][];
            notes: string;
            network: string;
            operator: string;
            country: string;
            lat_deg: number;
            lon_deg: number;
            alt_m: number;
            alt_known: boolean;
            alt_basis: "published" | "derived" | "unknown";
            dish_m?: number | null;
            bands: string[];
            min_elevation_deg: number;
            min_elevation_source: string;
            lunar_missions: string[];
            status: string;
        };
        StationPage: {
            total: number;
            items: components["schemas"]["StationEntry"][];
        };
        StationSeries: {
            network: string;
            min_elevation_deg: number;
            az_deg: number[];
            el_deg: number[];
            range_km: number[];
            station_el_deg: number[];
        };
        StoreCoverage: {
            whole_moon: boolean;
            centre_lat_deg: number | null;
            centre_lon_deg: number | null;
            radius_deg: number | null;
        };
        StoreInfo: {
            id: string;
            description: string;
            kind: "polar_stereographic" | "equirectangular";
            pole: number;
            pixel_size_m: number;
            ncols: number;
            nrows: number;
            n_levels: number;
            height_range_m: (number | null)[];
            bbox_map: components["schemas"]["MapBBox"];
            footprint?: components["schemas"]["GeoJsonPolygon"] | null;
            lat_extent_deg: number[];
            source: {
                [key: string]: unknown;
            };
            meta_hash: string;
        };
        StoreList: {
            stack_hash: string;
            stores: components["schemas"]["StoreInfo"][];
        };
        SubpointsRequest: {
            start_utc: string;
            end_utc: string;
            step_s: number;
            max_points: number | null;
            stellar_aberration: boolean;
            earth_view: boolean;
        };
        SubpointsResponse: {
            start_utc: string;
            end_utc: string;
            step_s_requested: number;
            step_s_effective: number;
            n_samples_full: number;
            n_samples: number;
            et_tdb_s: number[];
            utc: string[];
            subsolar_lat_deg: number[];
            subsolar_lon_deg: number[];
            subearth_lat_deg: number[];
            subearth_lon_deg: number[];
            conventions: string;
            provenance: components["schemas"]["SeriesProvenance"];
        };
        TargetSeries: {
            az_deg: number[];
            el_deg: number[];
            range_km: number[];
            ang_radius_deg: number[];
        };
        TerrainErrorSettings: {
            enabled: boolean;
            mode: "product" | "custom";
            sigma_z_m: number;
            sigma_xy_m: number;
            k_sigma: number;
            origin: components["schemas"]["Origin"];
        };
        TerrainStackUsed: {
            dem_ids: string[];
            stack_hash: string | null;
            is_default: boolean;
            restricted: boolean;
            chosen_by: "scenario" | "default" | "caller" | "none";
        };
        TerrainStoreInfo: {
            dem_id: string;
            meta_sha256: string;
            description?: string | null;
            projection?: string | null;
            pixel_size_m?: number | null;
            shape?: (number | null)[] | null;
            n_levels?: number | null;
            error?: string | null;
            precedence?: number | null;
            sigma_z_m?: number | null;
            sigma_xy_m?: number | null;
            error_basis_z?: string | null;
            error_source?: string | null;
            coverage?: components["schemas"]["StoreCoverage"] | null;
        } & {
            [key: string]: unknown;
        };
        TilesetDef: {
            id: "south-polar" | "north-polar" | "global";
            title: string;
            proj4: string;
            crs_extent: number[];
            units: "m" | "degree";
            tile_size: number;
            zoom_min: number;
            zoom_max: number;
            resolution_m_or_deg: number[];
            origin: "top-left";
            matrix: components["schemas"]["MatrixSize"][];
            url_template: string;
            layers: components["schemas"]["LayerDef"][];
            lat_limits: number[];
            elevation_range_m: number[];
            radius_m: number;
            pixel_registration: string;
        };
        TilesetList: {
            render_version: string;
            tilesets: components["schemas"]["TilesetDef"][];
        };
        TimeConvertRequest: {
            utc?: string[] | null;
            et_tdb_s?: number[] | null;
            digits: number;
        };
        TimeConvertResponse: {
            utc: string[];
            et_tdb_s: number[];
            leap_seconds_kernel: string;
        };
        TracksRequest: {
            start_utc: string;
            end_utc: string;
            step_s: number;
            max_points: number | null;
            site?: components["schemas"]["SiteIn"] | null;
            site_id?: string | null;
            bodies?: ("sun" | "earth")[];
            station_ids?: string[];
            include_eclipse_fraction: boolean;
        };
        TracksResponse: {
            site: components["schemas"]["SiteIn"];
            site_id: string | null;
            start_utc: string;
            end_utc: string;
            step_s_requested: number;
            step_s_effective: number;
            n_samples_full: number;
            n_samples: number;
            et_tdb_s: number[];
            utc: string[];
            sun: components["schemas"]["TargetSeries"] | null;
            earth: components["schemas"]["TargetSeries"] | null;
            earth_eclipse_fraction: number[] | null;
            stations: {
                [key: string]: components["schemas"]["StationSeries"];
            };
            conventions: string;
            provenance: components["schemas"]["SeriesProvenance"];
        };
        Transfer: {
            kind: "fixed" | "table";
            duration_days?: number | null;
            table: components["schemas"]["TransferRow"][];
            label: string;
            origin: components["schemas"]["Origin"];
        };
        TransferRow: {
            launch_utc: string;
            landing_utc: string;
        };
        ValidationError: {
            loc: (string | number)[];
            msg: string;
            type: string;
            input?: unknown;
            ctx?: Record<string, never>;
        };
        Verdict: {
            state: string;
            limiting: string | null;
            constraints: components["schemas"]["ConstraintVerdict"][];
        };
        WorldEvent: {
            world: string;
            et: number | null;
            utc: string;
            clipped: boolean;
            az_deg: number | null;
            horizon_elev_deg: number | null;
            blocker_dist_m: number | null;
            blocker: {
                [key: string]: number;
            } | null;
            cause: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    meta_api_v1_meta_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MetaResponse"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    regional_validation_api_v1_meta_regional_validation_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegionalValidationRecord"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    health_api_v1_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ready_api_v1_ready_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    list_sites_api_v1_sites_get: {
        parameters: {
            query?: {
                kind?: ("landed" | "impact" | "planned" | "not_landed" | "region" | "poi")[] | null;
                region?: ("south_polar" | "south_high" | "mid" | "north_high" | "north_polar") | null;
                bbox?: string | null;
                q?: string | null;
                confidence?: components["schemas"]["Confidence"] | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SitePage"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_site_api_v1_sites__site_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                site_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SiteEntry"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_stations_api_v1_stations_get: {
        parameters: {
            query?: {
                network?: string | null;
                q?: string | null;
                bbox?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StationPage"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_networks_api_v1_stations_networks_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NetworkCount"][];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_station_api_v1_stations__station_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                station_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StationEntry"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_landers_api_v1_landers_get: {
        parameters: {
            query?: {
                q?: string | null;
                status?: ("flown" | "in_development" | "retired" | "cancelled") | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LanderPage"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_lander_api_v1_landers__lander_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                lander_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LanderEntry"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    tracks_api_v1_ephemeris_tracks_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TracksRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TracksResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    tracks_job_api_v1_ephemeris_tracks_jobs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TracksRequest"];
            };
        };
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    subpoints_api_v1_ephemeris_subpoints_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubpointsRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubpointsResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    subpoints_job_api_v1_ephemeris_subpoints_jobs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubpointsRequest"];
            };
        };
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    convert_time_api_v1_time_convert_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["TimeConvertRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TimeConvertResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_jobs_api_v1_jobs_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"][];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_job_api_v1_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    job_events_api_v1_jobs__job_id__events_get: {
        parameters: {
            query?: {
                after_id?: number | null;
            };
            header?: {
                "Last-Event-ID"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    cancel_job_api_v1_jobs__job_id__cancel_post: {
        parameters: {
            query?: {
                force?: boolean;
            };
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CancelReply"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    job_result_api_v1_jobs__job_id__result_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobResult"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    validate_api_v1_scenarios_validate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioCreate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioValidation"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_scenarios_api_v1_scenarios_get: {
        parameters: {
            query?: {
                q?: string | null;
                limit?: number;
                offset?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioPage"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    create_api_v1_scenarios_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioCreate"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioRecord"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    read_api_v1_scenarios__scenario_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenario_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioRecord"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    update_api_v1_scenarios__scenario_id__put: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenario_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScenarioUpdate"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioRecord"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    delete_api_v1_scenarios__scenario_id__delete: {
        parameters: {
            query?: {
                expected_version?: number | null;
            };
            header?: never;
            path: {
                scenario_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    revisions_api_v1_scenarios__scenario_id__revisions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenario_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RevisionInfo"][];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    revision_api_v1_scenarios__scenario_id__revisions__version__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                scenario_id: string;
                version: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScenarioRecord"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    access_api_v1_agent_access_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessState"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    unlock_api_v1_agent_access_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AccessCode"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessState"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    lock_api_v1_agent_access_delete: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AccessState"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    instructions_api_v1_agent_instructions_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Instructions"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    schema_api_v1_agent_event_schema_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_runs_api_v1_agent_runs_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"][];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    start_run_api_v1_agent_runs_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RunCreate"];
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_run_api_v1_agent_runs__run_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    send_message_api_v1_agent_runs__run_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageCreate"];
            };
        };
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    interrupt_api_v1_agent_runs__run_id__interrupt_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    close_run_api_v1_agent_runs__run_id__close_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RunMeta"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    events_api_v1_agent_runs__run_id__events_get: {
        parameters: {
            query?: {
                after_seq?: number | null;
                follow?: boolean;
                stop_on?: "none" | "turn_end" | "run_end";
            };
            header?: {
                "Last-Event-ID"?: string | null;
            };
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": unknown;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ledger_api_v1_agent_runs__run_id__ledger_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerList"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ledger_entry_result_api_v1_agent_runs__run_id__ledger__ledger_id__result_get: {
        parameters: {
            query?: {
                row_id?: string | null;
            };
            header?: never;
            path: {
                run_id: string;
                ledger_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerResult"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    assumptions_api_v1_agent_runs__run_id__assumptions_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssumptionList"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    signoff_api_v1_agent_runs__run_id__assumptions__assumption_id__signoff_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
                assumption_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SignoffRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AssumptionItem"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    inbox_api_v1_agent_runs__run_id__inbox_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InboxList"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    upload_inbox_api_v1_agent_runs__run_id__inbox_post: {
        parameters: {
            query: {
                filename: string;
            };
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/octet-stream": string;
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["InboxEntry"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    artifacts_api_v1_agent_runs__run_id__artifacts_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LedgerList"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    artifact_content_api_v1_agent_runs__run_id__artifacts__artifact_id__content_get: {
        parameters: {
            query?: {
                version?: number | null;
            };
            header?: never;
            path: {
                run_id: string;
                artifact_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "*/*": unknown;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_evidence_api_v1_evidence_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvidenceDoc"][];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    evidence_asset_api_v1_evidence_assets__path__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                path: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/*": unknown;
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    evidence_doc_api_v1_evidence__doc_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                doc_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/markdown": unknown;
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_stores_api_v1_terrain_stores_get: {
        parameters: {
            query?: {
                source_label?: boolean;
                footprint?: "simple" | "full" | "none";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StoreList"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    list_tilesets_api_v1_terrain_tilesets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TilesetList"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_tile_api_v1_terrain_tiles__tileset___layer___z___x___y__png_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tileset: string;
                layer: string;
                z: number;
                x: number;
                y: number;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "image/png": unknown;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_point_api_v1_terrain_point_get: {
        parameters: {
            query: {
                lat: number;
                lon: number;
                baseline_m?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PointResult"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    post_points_api_v1_terrain_points_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PointsRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PointsResponse"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_patch_api_v1_terrain_patch_get: {
        parameters: {
            query: {
                lat: number;
                lon: number;
                size_m: number;
                n: number;
                include_source?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": unknown;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    get_patch_header_api_v1_terrain_patch_header_get: {
        parameters: {
            query: {
                lat: number;
                lon: number;
                size_m: number;
                n: number;
                include_source?: boolean;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PatchHeader"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    profiles_api_v1_profiles_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProfilesResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    constraint_presets_api_v1_constraints_presets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConstraintPresetsResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    network_presets_api_v1_networks_presets_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NetworkPresetsResponse"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    schema_api_v1_schemas__name__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    evaluate_api_v1_analyses_evaluate_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EvaluateRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EvaluateResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    scan_api_v1_analyses_scan_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ScanRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ScanResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    slip_api_v1_analyses_slip_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SlipRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SlipResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    height_sensitivity_api_v1_analyses_sensitivity_height_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HeightSensitivityRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SensitivityResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    position_sensitivity_api_v1_analyses_sensitivity_position_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PositionSensitivityRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SensitivityResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    attribution_api_v1_analyses_attribution_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AttributionRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AttributionResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    ellipse_api_v1_analyses_ellipse_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EllipseRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EllipseResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    search_api_v1_analyses_search_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SearchRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SearchResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    regional_api_v1_analyses_regional_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegionalRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RegionalResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    compare_api_v1_analyses_compare_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CompareRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CompareResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    horizon_api_v1_horizon_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["HorizonRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HorizonResult"];
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    export_api_v1_exports__kind__post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                kind: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ExportRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/plain": unknown;
                    "text/csv": unknown;
                    "application/json": unknown;
                    "application/zip": unknown;
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    report_api_v1_report_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReportRequest"];
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": unknown;
                    "application/pdf": unknown;
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    delete_export_files_api_v1_exports_files__digest__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                digest: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    export_file_api_v1_exports_files__digest___name__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                digest: string;
                name: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": unknown;
                };
            };
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobStatus"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": unknown;
                    "application/json": components["schemas"]["Problem"];
                };
            };
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
}
