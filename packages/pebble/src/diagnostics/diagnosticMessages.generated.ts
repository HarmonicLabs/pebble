// GENERATED FILE. DO NOT EDIT.

/** Enum of available diagnostic codes. */
export enum DiagnosticCode {
    Not_implemented_0 = 100,
    Contract_is_missing = 101,
    Contract_declarations_cannot_be_exported = 102,
    Conversion_from_type_0_to_1_requires_an_explicit_cast = 200,
    Conversion_from_type_0_to_1_will_require_an_explicit_cast_when_switching_between_32_64_bit = 201,
    Type_0_cannot_be_changed_to_type_1 = 202,
    Operation_0_cannot_be_applied_to_type_1 = 203,
    Type_0_cannot_be_nullable = 204,
    Mutable_value_cannot_be_inlined = 206,
    Unmanaged_classes_cannot_extend_managed_classes_and_vice_versa = 207,
    Unmanaged_classes_cannot_implement_interfaces = 208,
    Invalid_regular_expression_flags = 209,
    Expression_is_never_null = 210,
    Class_0_is_final_and_cannot_be_extended = 211,
    Decorator_0_is_not_valid_here = 212,
    Duplicate_decorator = 213,
    Type_0_is_illegal_in_this_context = 214,
    Optional_parameter_must_have_an_initializer = 215,
    Class_0_cannot_declare_a_constructor_when_instantiated_from_an_object_literal = 216,
    Function_0_cannot_be_inlined_into_itself = 217,
    Cannot_access_method_0_without_calling_it_as_it_requires_this_to_be_set = 218,
    Optional_properties_are_not_supported = 219,
    Expression_must_be_a_compile_time_constant = 220,
    Type_0_is_not_a_function_index_or_function_reference = 221,
    _0_must_be_a_value_between_1_and_2_inclusive = 222,
    _0_must_be_a_power_of_two = 223,
    _0_is_not_a_valid_operator = 224,
    Expression_cannot_be_represented_by_a_type = 225,
    Expression_resolves_to_unusual_type_0 = 226,
    Array_literal_expected = 227,
    Function_0_is_virtual_and_will_not_be_inlined = 228,
    Property_0_only_has_a_setter_and_is_missing_a_getter = 229,
    _0_keyword_cannot_be_used_here = 230,
    A_class_with_a_constructor_explicitly_returning_something_else_than_this_must_be_final = 231,
    Property_0_is_always_assigned_before_being_used = 233,
    Expression_does_not_compile_to_a_value_at_runtime = 234,
    Literal_0_does_not_fit_into_i64_or_u64_types = 236,
    Index_signature_accessors_in_type_0_differ_in_types = 237,
    Initializer_definitive_assignment_or_nullable_type_expected = 238,
    Definitive_assignment_has_no_effect_on_local_variables = 239,
    Ambiguous_operator_overload_0_conflicting_overloads_1_and_2 = 240,
    A_variable_statement_must_have_at_least_one_variable_declaration = 241,
    A_field_in_a_deconstructed_declaration_cannot_have_an_initialization = 242,
    A_field_in_a_deconstructed_declaration_cannot_have_an_explicit_type_did_you_mean_to_cast_using_the_as_keyword = 243,
    Object_literal_expected = 244,
    Initialization_expressions_are_not_allowed_in_a_struct_declaration = 245,
    Empty_array_litteral_must_be_explicitly_cast_to_a_type = 246,
    Cannot_infer_type_for_empty_array_litteral = 247,
    Litteral_value_undefined_must_be_explicitly_cast_to_an_Optional_type = 248,
    Unnamed_object_litteral_must_be_explicitly_cast_to_a_type = 249,
    Unnamed_object_litteral_does_not_match_0_struct_definition = 250,
    Unnamed_object_litteral_is_not_assignable_to_0_An_explicit_constrctor_must_be_used = 251,
    Unnamed_object_litteral_is_not_assignable_to_0 = 252,
    Unnamed_object_litteral_is_not_assignable_to_0_The_fields_do_not_match_the_the_type_definition = 253,
    Field_0_is_not_part_of_the_1_constructor_for_2_struct = 254,
    Field_0_is_missing_but_required_by_the_1_constructor_of_the_2_struct = 254,
    Named_object_litteral_is_not_assignable_to_0 = 255,
    _0_is_not_defined = 256,
    Cannot_infer_struct_type_from_constructor_0_Declare_it_with_a_using_keyword_declaration = 257,
    Constructor_0_aliased_as_1_is_not_part_of_the_2_definition = 258,
    Deconstructing_0_requires_the_name_of_the_constructor = 259,
    Construcotr_0_is_not_part_of_the_definiton_of_1 = 260,
    Invalid_rest_parameter_there_are_no_more_fields = 261,
    Cannot_infer_variable_type_Try_to_make_the_type_explicit = 262,
    Cannot_infer_return_type_Try_to_make_the_type_explicit = 263,
    Cannot_use_is_operator_on_a_value_that_is_not_a_struct_type = 264,
    Constructor_0_is_not_part_of_the_definition_of_1 = 265,
    This_check_is_redundant_Struct_0_has_only_one_possible_constructor = 266,
    This_expression_cannot_be_indexed = 267,
    Cannot_evaluate_type_expression = 268,
    Type_0_does_not_have_constructors = 269,
    Constructor_name_0_is_already_declared_in_this_scope = 270,
    Unterminated_Unicode_escape_sequence = 271,
    Left_side_of_opeartor_is_not_optional_right_side_is_unused = 272,
    _0_is_already_defined = 273,
    _0_is_already_exported = 274,
    _export_keyword_cannot_be_used_here = 275,
    Only_constants_can_be_declared_outside_of_a_function = 276,
    Only_function_declarations_and_constants_can_be_exported = 277,
    function_declarations_are_only_allowed_at_the_top_level = 278,
    type_declarations_and_interfaces_are_only_allowed_at_the_top_level = 279,
    Type_0_cannot_be_encoded_as_data = 280,
    Type_0_cannot_be_encoded_as_data_but_it_has_a_runtime_encoding_Use_runtime_keyword_modifier_for_the_declaration = 281,
    Default_method_implementatitons_are_not_supported_default_implementation_will_be_ignored = 282,
    Interface_implementations_cannot_be_exported = 282,
    Method_implementations_are_only_allowed_for_types_declared_locally = 283,
    Method_0_is_already_implemented = 283,
    While_compiling_function_expression_expected_type_was_not_a_function = 284,
    Could_not_infer_function_signature_parameter_type_is_missing = 285,
    Could_not_infer_function_signature_return_type_is_missing = 286,
    _case_expression_must_decontructed_the_inspected_value = 287,
    for_loop_initialization_variables_cannot_be_destructured_Declare_it_as_a_simple_variable_and_move_the_destructuring_in_the_loop_body = 288,
    Match_cases_are_not_exhaustive = 289,
    Contract_methods_must_return_void_or_fail = 290,
    Contract_parameters_cannot_have_an_initializer_expression = 291,
    _context_can_only_be_destructured_in_a_constant_declaration = 292,
    _context_can_only_be_accessed_in_a_contract_method = 293,
    _this_in_a_contract_context_can_only_be_used_to_read_parameters_in_a_contract_method = 293,
    _0_is_not_available_in_this_contract_method_context = 294,
    _context_can_only_be_destructured_as_an_unnamed_object = 295,
    _0_is_not_a_contract_parameter = 296,
    Importing_the_table_disables_some_indirect_call_optimizations = 901,
    Exporting_the_table_disables_some_indirect_call_optimizations = 902,
    Expression_compiles_to_a_dynamic_check_at_runtime = 903,
    Indexed_access_may_involve_bounds_checking = 904,
    Explicitly_returning_constructor_drops_this_allocation = 905,
    Unnecessary_definite_assignment = 906,
    _NaN_does_not_compare_equal_to_any_other_value_including_itself_Use_isNaN_x_instead = 907,
    Comparison_with_0_0_is_sign_insensitive_Use_Object_is_x_0_0_if_the_sign_matters = 908,
    Unterminated_string_literal = 1002,
    Identifier_expected = 1003,
    _0_expected = 1005,
    A_file_cannot_have_a_reference_to_itself = 1006,
    Trailing_comma_not_allowed = 1009,
    Unexpected_token = 1012,
    A_rest_parameter_must_be_last_in_a_parameter_list = 1014,
    Parameter_cannot_have_question_mark_and_initializer = 1015,
    A_required_parameter_cannot_follow_an_optional_parameter = 1016,
    _0_modifier_cannot_appear_on_class_elements_of_this_kind = 1031,
    Statements_are_not_allowed_in_ambient_contexts = 1036,
    Initializers_are_not_allowed_in_ambient_contexts = 1039,
    _0_modifier_cannot_be_used_here = 1042,
    A_rest_parameter_cannot_be_optional = 1047,
    A_rest_parameter_cannot_have_an_initializer = 1048,
    A_set_accessor_must_have_exactly_one_parameter = 1049,
    A_set_accessor_parameter_cannot_have_an_initializer = 1052,
    A_get_accessor_cannot_have_parameters = 1054,
    Enum_member_must_have_initializer = 1061,
    Type_parameters_cannot_appear_on_a_constructor_declaration = 1092,
    Type_annotation_cannot_appear_on_a_constructor_declaration = 1093,
    An_accessor_cannot_have_type_parameters = 1094,
    A_set_accessor_cannot_have_a_return_type_annotation = 1095,
    Type_parameter_list_cannot_be_empty = 1098,
    Type_argument_list_cannot_be_empty = 1099,
    A_continue_statement_can_only_be_used_within_a_loop = 1104,
    A_break_statement_can_only_be_used_within_a_loop = 1105,
    A_return_statement_can_only_be_used_within_a_function_body = 1108,
    Expression_expected = 1109,
    Type_expected = 1110,
    A_default_clause_cannot_appear_more_than_once_in_a_switch_statement = 1113,
    Duplicate_label_0 = 1114,
    Octal_literals_are_not_allowed_in_strict_mode = 1121,
    Digit_expected = 1124,
    Hexadecimal_digit_expected = 1125,
    Unexpected_end_of_text = 1126,
    Invalid_character = 1127,
    Type_argument_expected = 1140,
    String_literal_expected = 1141,
    Line_break_not_permitted_here = 1142,
    Declaration_expected = 1146,
    _const_declarations_must_be_initialized = 1155,
    Unterminated_regular_expression_literal = 1161,
    Declarations_with_initializers_cannot_also_have_definite_assignment_assertions = 1263,
    Interface_declaration_cannot_have_implements_clause = 1176,
    Binary_digit_expected = 1177,
    Octal_digit_expected = 1178,
    An_implementation_cannot_be_declared_in_ambient_contexts = 1183,
    The_variable_declaration_of_a_for_of_statement_cannot_have_an_initializer = 1190,
    An_extended_Unicode_escape_value_must_be_between_0x0_and_0x10FFFF_inclusive = 1198,
    A_parameter_property_cannot_be_declared_using_a_rest_parameter = 1317,
    An_identifier_or_keyword_cannot_immediately_follow_a_numeric_literal = 1351,
    A_destructured_parameter_for_a_constructor_cannot_have_a_modifier = 1352,
    A_rest_element_must_be_last_in_an_object_destructuring_pattern = 1353,
    An_identifier_cannot_preceed_array_destructuring = 1354,
    A_rest_element_must_be_last_in_an_array_destructuring_pattern = 1355,
    Invaild_destructuring = 1356,
    Destructuring_requires_an_initializer_expression = 1362,
    Only_a_single_variable_is_allowed_in_a_for_of_statement = 1363,
    Rest_parameters_are_not_supported_in_pebble_cosider_using_a_concrete_parameter_with_default_value = 1364,
    A_test_can_only_be_specified_at_the_top_level_of_the_file_it_cannot_be_defined_in_functions_etc = 1365,
    Tests_must_be_specified_in_a_block_statement = 1365,
    Pattern_expected = 1366,
    This_case_will_never_be_evaluated_because_all_patterns_will_be_catched_before = 1367,
    Statement_expected = 1368,
    Patterns_may_not_have_initializers_or_explicit_types = 1369,
    A_case_expression_must_have_at_least_one_clause = 1370,
    A_match_statement_must_have_at_least_one_case = 1371,
    Cases_in_a_match_statement_must_be_followed_by_other_statements = 1372,
    Variable_declaration_must_have_an_initializer = 1373,
    Deconstructed_elements_may_not_have_initializers_or_explicit_types = 1374,
    Invalid_field_declaration = 1375,
    Field_declarations_must_be_typed = 1376,
    Type_parameters_must_be_identifiers = 1377,
    Invalid_for_statement_update = 1378,
    The_argument_of_a_for_of_statement_must_be_an_iterable = 1379,
    A_fail_statement_can_only_be_used_within_a_function_body = 1380,
    An_assert_statement_can_only_be_used_within_a_function_body = 1381,
    A_test_statement_can_only_be_used_outside_a_function = 1382,
    A_match_statement_can_only_be_used_within_a_function_body = 1383,
    A_value_of_type_0_cannot_be_deconstructed = 1384,
    The_argument_of_a_match_statement_branch_must_be_deconstructed = 1385,
    A_value_of_type_0_cannot_be_deconstructed_by_named_object = 1385,
    A_value_of_type_0_cannot_be_deconstructed_as_unnamed_object = 1386,
    A_value_of_type_0_has_multiple_constructors = 1387,
    Unknown_0_constructor_1 = 1388,
    Constructor_0_was_already_specified = 1389,
    A_value_of_type_0_cannot_be_deconstructed_as_an_array = 1390,
    Expression_is_not_callable = 1391,
    Unexpected_argument = 1392,
    Duplicate_identifier_0 = 2300,
    Cannot_find_name_0 = 2304,
    Module_0_has_no_exported_member_1 = 2305,
    File_0_has_no_exports = 2306,
    An_interface_can_only_extend_an_interface = 2312,
    Generic_type_0_requires_1_type_argument_s = 2314,
    Type_0_is_not_generic = 2315,
    Type_0_is_not_assignable_to_type_1 = 2322,
    Property_0_is_private_in_type_1_but_not_in_type_2 = 2325,
    Index_signature_is_missing_in_type_0 = 2329,
    _this_cannot_be_referenced_in_current_location = 2332,
    _this_cannot_be_referenced_in_constructor_arguments = 2333,
    _super_can_only_be_referenced_in_a_derived_class = 2335,
    _super_cannot_be_referenced_in_constructor_arguments = 2336,
    Super_calls_are_not_permitted_outside_constructors_or_in_nested_functions_inside_constructors = 2337,
    Property_0_does_not_exist_on_type_1 = 2339,
    Property_0_is_private_and_only_accessible_within_class_1 = 2341,
    Cannot_invoke_an_expression_whose_type_lacks_a_call_signature_Type_0_has_no_compatible_call_signatures = 2349,
    This_expression_is_not_constructable = 2351,
    A_function_whose_declared_type_is_not_void_must_return_a_value = 2355,
    The_operand_of_an_increment_or_decrement_operator_must_be_a_variable = 2357,
    The_left_hand_side_of_an_assignment_expression_must_be_a_variable_or_a_property_access = 2364,
    Operator_0_cannot_be_applied_to_types_1_and_2 = 2365,
    A_super_call_must_be_the_first_statement_in_the_constructor = 2376,
    Constructors_for_derived_classes_must_contain_a_super_call = 2377,
    _get_and_set_accessor_must_have_the_same_type = 2380,
    Overload_signatures_must_all_be_public_private_or_protected = 2385,
    Constructor_implementation_is_missing = 2390,
    Function_implementation_is_missing_or_not_immediately_following_the_declaration = 2391,
    Multiple_constructor_implementations_are_not_allowed = 2392,
    Duplicate_function_implementation = 2393,
    This_overload_signature_is_not_compatible_with_its_implementation_signature = 2394,
    Property_0_in_type_1_is_not_assignable_to_the_same_property_in_base_type_2 = 2416,
    A_class_can_only_implement_an_interface = 2422,
    A_namespace_declaration_cannot_be_located_prior_to_a_class_or_function_with_which_it_is_merged = 2434,
    Types_have_separate_declarations_of_a_private_property_0 = 2442,
    Property_0_is_protected_in_type_1_but_public_in_type_2 = 2444,
    Property_0_is_protected_and_only_accessible_within_class_1_and_its_subclasses = 2445,
    Variable_0_used_before_its_declaration = 2448,
    Cannot_redeclare_block_scoped_variable_0 = 2451,
    The_type_argument_for_type_parameter_0_cannot_be_inferred_from_the_usage_Consider_specifying_the_type_arguments_explicitly = 2453,
    Variable_0_is_used_before_being_assigned = 2454,
    Type_alias_0_circularly_references_itself = 2456,
    Type_0_has_no_property_1 = 2460,
    The_0_operator_cannot_be_applied_to_type_1 = 2469,
    In_const_enum_declarations_member_initializer_must_be_constant_expression = 2474,
    _0_is_referenced_directly_or_indirectly_in_its_own_base_expression = 2506,
    Object_is_possibly_null = 2531,
    Cannot_assign_to_0_because_it_is_a_constant = 2540,
    The_target_of_an_assignment_must_be_a_variable = 2541,
    Index_signature_in_type_0_only_permits_reading = 2542,
    Expected_0_arguments_but_got_1 = 2554,
    Expected_at_least_0_arguments_but_got_1 = 2555,
    Expected_0_type_arguments_but_got_1 = 2558,
    Property_0_has_no_initializer_and_is_not_assigned_in_the_constructor_before_this_is_used_or_returned = 2564,
    Property_0_is_used_before_being_assigned = 2565,
    Constructor_of_class_0_is_private_and_only_accessible_within_the_class_declaration = 2673,
    Constructor_of_class_0_is_protected_and_only_accessible_within_the_class_declaration = 2674,
    Cannot_extend_a_class_0_Class_constructor_is_marked_as_private = 2675,
    The_this_types_of_each_signature_are_incompatible = 2685,
    Namespace_can_only_have_declarations = 2695,
    Required_type_parameters_may_not_follow_optional_type_parameters = 2706,
    Duplicate_property_0 = 2718,
    Property_0_is_missing_in_type_1_but_required_in_type_2 = 2741,
    Type_0_has_no_call_signatures = 2757,
    Get_accessor_0_must_be_at_least_as_accessible_as_the_setter = 2808,
    Type_parameter_is_unused = 2809,
    Assignments_are_statements_not_expressions = 2810,
    Type_parameter_name_must_not_match_a_native_type_name = 2811,
    Type_0_cannot_be_converted_to_type_1 = 2812,
    Non_null_opeartor_used_on_expression_of_type_0_which_is_not_optional_this_will_be_omitted_during_compilation = 2813,
    File_0_not_found = 6054,
    Import_path_0_is_part_of_a_circular_dependency = 6055,
    Numeric_separators_are_not_allowed_here = 6188,
    Multiple_consecutive_numeric_separators_are_not_permitted = 6189,
    This_expression_is_not_callable_because_it_is_a_get_accessor_Did_you_mean_to_use_it_without = 6234,
    _super_must_be_called_before_accessing_this_in_the_constructor_of_a_derived_class = 17009,
    _super_must_be_called_before_accessing_a_property_of_super_in_the_constructor_of_a_derived_class = 17011,
    Unkonwn_AST_node = 20000,
    Namespace_0_has_no_exported_member_1 = 30001,
    Namespace_path_is_incomplete_expected_a_value_type_function_or_interface = 30002,
    _private_modifier_is_only_allowed_on_declarations_inside_a_namespace = 30003,
    Namespaces_cannot_be_declared_here = 30004,
    _0_is_not_a_namespace = 30005,
    Enum_members_cannot_have_explicit_values = 30100,
    Duplicate_enum_member_0 = 30101,
    Enum_must_have_at_least_one_member = 30102,
    Property_0_is_not_a_member_of_enum_1 = 30103,
    Enum_member_pattern_cannot_have_fields = 30104,
    Dev_was_too_lazy_to_add_a_prooper_error_message_Something_went_wrong = 42069
}

/** Translates a diagnostic code to its respective string. */
export function diagnosticCodeToString(code: DiagnosticCode): string {
    switch (code) {
        case 100: return "Not implemented: {0}";
        case 101: return "Contract is missing";
        case 102: return "Contract declarations cannot be exported";
        case 200: return "Conversion from type '{0}' to '{1}' requires an explicit cast.";
        case 201: return "Conversion from type '{0}' to '{1}' will require an explicit cast when switching between 32/64-bit.";
        case 202: return "Type '{0}' cannot be changed to type '{1}'.";
        case 203: return "Operation '{0}' cannot be applied to type '{1}'.";
        case 204: return "Type '{0}' cannot be nullable.";
        case 206: return "Mutable value cannot be inlined.";
        case 207: return "Unmanaged classes cannot extend managed classes and vice-versa.";
        case 208: return "Unmanaged classes cannot implement interfaces.";
        case 209: return "Invalid regular expression flags.";
        case 210: return "Expression is never 'null'.";
        case 211: return "Class '{0}' is final and cannot be extended.";
        case 212: return "Decorator '{0}' is not valid here.";
        case 213: return "Duplicate decorator.";
        case 214: return "Type '{0}' is illegal in this context.";
        case 215: return "Optional parameter must have an initializer.";
        case 216: return "Class '{0}' cannot declare a constructor when instantiated from an object literal.";
        case 217: return "Function '{0}' cannot be inlined into itself.";
        case 218: return "Cannot access method '{0}' without calling it as it requires 'this' to be set.";
        case 219: return "Optional properties are not supported.";
        case 220: return "Expression must be a compile-time constant.";
        case 221: return "Type '{0}' is not a function index or function reference.";
        case 222: return "'{0}' must be a value between '{1}' and '{2}' inclusive.";
        case 223: return "'{0}' must be a power of two.";
        case 224: return "'{0}' is not a valid operator.";
        case 225: return "Expression cannot be represented by a type.";
        case 226: return "Expression resolves to unusual type '{0}'.";
        case 227: return "Array literal expected.";
        case 228: return "Function '{0}' is virtual and will not be inlined.";
        case 229: return "Property '{0}' only has a setter and is missing a getter.";
        case 230: return "'{0}' keyword cannot be used here.";
        case 231: return "A class with a constructor explicitly returning something else than 'this' must be '@final'.";
        case 233: return "Property '{0}' is always assigned before being used.";
        case 234: return "Expression does not compile to a value at runtime.";
        case 236: return "Literal '{0}' does not fit into 'i64' or 'u64' types.";
        case 237: return "Index signature accessors in type '{0}' differ in types.";
        case 238: return "Initializer, definitive assignment or nullable type expected.";
        case 239: return "Definitive assignment has no effect on local variables.";
        case 240: return "Ambiguous operator overload '{0}' (conflicting overloads '{1}' and '{2}').";
        case 241: return "A variable statement must have at least one variable declaration.";
        case 242: return "A field in a deconstructed declaration cannot have an initialization";
        case 243: return "A field in a deconstructed declaration cannot have an explicit type; did you mean to cast using the 'as' keyword?";
        case 244: return "Object literal expected";
        case 245: return "Initialization expressions are not allowed in a struct declaration";
        case 246: return "Empty array litteral must be explicitly cast to a type.";
        case 247: return "Cannot infer type for empty array litteral.";
        case 248: return "Litteral value undefined must be explicitly cast to an Optional type.";
        case 249: return "Unnamed object litteral must be explicitly cast to a type.";
        case 250: return "Unnamed object litteral does not match '{0}' struct definition.";
        case 251: return "Unnamed object litteral is not assignable to {0}. An explicit constrctor must be used.";
        case 252: return "Unnamed object litteral is not assignable to {0}.";
        case 253: return "Unnamed object litteral is not assignable to {0}. The fields do not match the the type definition.";
        case 254: return "Field '{0}' is not part of the '{1}' constructor for '{2}' struct.";
        case 254: return "Field '{0}' is missing, but required by the '{1}' constructor of the '{2}' struct.";
        case 255: return "Named object litteral is not assignable to {0}.";
        case 256: return "'{0}' is not defined";
        case 257: return "Cannot infer struct type from constructor '{0}'. Declare it with a 'using' keyword declaration.";
        case 258: return "Constructor '{0}', aliased as '{1}', is not part of the '{2}' definition.";
        case 259: return "Deconstructing '{0}' requires the name of the constructor.";
        case 260: return "Construcotr '{0}' is not part of the definiton of '{1}'.";
        case 261: return "Invalid rest parameter, there are no more fields.";
        case 262: return "Cannot infer variable type. Try to make the type explicit.";
        case 263: return "Cannot infer return type. Try to make the type explicit.";
        case 264: return "Cannot use 'is' operator on a value that is not a struct type.";
        case 265: return "Constructor '{0}' is not part of the definition of '{1}'.";
        case 266: return "This check is redundant. Struct '{0}' has only one possible constructor.";
        case 267: return "This expression cannot be indexed.";
        case 268: return "Cannot evaluate type expression.";
        case 269: return "Type '{0}' does not have constructors.";
        case 270: return "Constructor name '{0}' is already declared in this scope.";
        case 271: return "Unterminated Unicode escape sequence";
        case 272: return "Left side of '??' opeartor is not optional, right side is unused";
        case 273: return "'{0}' is already defined.";
        case 274: return "'{0}' is already exported.";
        case 275: return "'export' keyword cannot be used here.";
        case 276: return "Only constants can be declared outside of a function.";
        case 277: return "Only function declarations and constants can be exported.";
        case 278: return "function declarations are only allowed at the top level.";
        case 279: return "type declarations and interfaces are only allowed at the top level.";
        case 280: return "Type '{0}' cannot be encoded as data";
        case 281: return "Type '{0}' cannot be encoded as data, but it has a runtime encoding. Use `runtime` keyword modifier for the declaration.";
        case 282: return "Default method implementatitons are not supported. default implementation will be ignored.";
        case 282: return "Interface implementations cannot be exported.";
        case 283: return "Method implementations are only allowed for types declared locally.";
        case 283: return "Method '{0}' is already implemented.";
        case 284: return "While compiling function expression; expected type was not a function.";
        case 285: return "Could not infer function signature, parameter type is missing.";
        case 286: return "Could not infer function signature, return type is missing.";
        case 287: return "'case' expression must decontructed the inspected value.";
        case 288: return "for loop initialization variables cannot be destructured. Declare it as a simple variable and move the destructuring in the loop body";
        case 289: return "Match cases are not exhaustive";
        case 290: return "Contract methods must return void or fail";
        case 291: return "Contract parameters cannot have an initializer expression";
        case 292: return "`context` can only be destructured in a constant declaration.";
        case 293: return "`context` can only be accessed in a contract method.";
        case 293: return "`this`, in a contract context, can only be used to read parameters in a contract method.";
        case 294: return "`{0}` is not available in this contract method `context`.";
        case 295: return "`context` can only be destructured as an unnamed object.";
        case 296: return "'{0}' is not a contract parameter.";
        case 901: return "Importing the table disables some indirect call optimizations.";
        case 902: return "Exporting the table disables some indirect call optimizations.";
        case 903: return "Expression compiles to a dynamic check at runtime.";
        case 904: return "Indexed access may involve bounds checking.";
        case 905: return "Explicitly returning constructor drops 'this' allocation.";
        case 906: return "Unnecessary definite assignment.";
        case 907: return "'NaN' does not compare equal to any other value including itself. Use isNaN(x) instead.";
        case 908: return "Comparison with -0.0 is sign insensitive. Use Object.is(x, -0.0) if the sign matters.";
        case 1002: return "Unterminated string literal.";
        case 1003: return "Identifier expected.";
        case 1005: return "'{0}' expected.";
        case 1006: return "A file cannot have a reference to itself.";
        case 1009: return "Trailing comma not allowed.";
        case 1012: return "Unexpected token.";
        case 1014: return "A rest parameter must be last in a parameter list.";
        case 1015: return "Parameter cannot have question mark and initializer.";
        case 1016: return "A required parameter cannot follow an optional parameter.";
        case 1031: return "'{0}' modifier cannot appear on class elements of this kind.";
        case 1036: return "Statements are not allowed in ambient contexts.";
        case 1039: return "Initializers are not allowed in ambient contexts.";
        case 1042: return "'{0}' modifier cannot be used here.";
        case 1047: return "A rest parameter cannot be optional.";
        case 1048: return "A rest parameter cannot have an initializer.";
        case 1049: return "A 'set' accessor must have exactly one parameter.";
        case 1052: return "A 'set' accessor parameter cannot have an initializer.";
        case 1054: return "A 'get' accessor cannot have parameters.";
        case 1061: return "Enum member must have initializer.";
        case 1092: return "Type parameters cannot appear on a constructor declaration.";
        case 1093: return "Type annotation cannot appear on a constructor declaration.";
        case 1094: return "An accessor cannot have type parameters.";
        case 1095: return "A 'set' accessor cannot have a return type annotation.";
        case 1098: return "Type parameter list cannot be empty.";
        case 1099: return "Type argument list cannot be empty.";
        case 1104: return "A 'continue' statement can only be used within a loop.";
        case 1105: return "A 'break' statement can only be used within a loop.";
        case 1108: return "A 'return' statement can only be used within a function body.";
        case 1109: return "Expression expected.";
        case 1110: return "Type expected.";
        case 1113: return "A 'default' clause cannot appear more than once in a 'switch' statement.";
        case 1114: return "Duplicate label '{0}'.";
        case 1121: return "Octal literals are not allowed in strict mode.";
        case 1124: return "Digit expected.";
        case 1125: return "Hexadecimal digit expected.";
        case 1126: return "Unexpected end of text.";
        case 1127: return "Invalid character.";
        case 1140: return "Type argument expected.";
        case 1141: return "String literal expected.";
        case 1142: return "Line break not permitted here.";
        case 1146: return "Declaration expected.";
        case 1155: return "'const' declarations must be initialized.";
        case 1161: return "Unterminated regular expression literal.";
        case 1263: return "Declarations with initializers cannot also have definite assignment assertions.";
        case 1176: return "Interface declaration cannot have 'implements' clause.";
        case 1177: return "Binary digit expected.";
        case 1178: return "Octal digit expected.";
        case 1183: return "An implementation cannot be declared in ambient contexts.";
        case 1190: return "The variable declaration of a 'for...of' statement cannot have an initializer.";
        case 1198: return "An extended Unicode escape value must be between 0x0 and 0x10FFFF inclusive.";
        case 1317: return "A parameter property cannot be declared using a rest parameter.";
        case 1351: return "An identifier or keyword cannot immediately follow a numeric literal.";
        case 1352: return "A destructured parameter for a constructor cannot have a modifier";
        case 1353: return "A rest element must be last in an object destructuring pattern";
        case 1354: return "An identifier cannot preceed array destructuring";
        case 1355: return "A rest element must be last in an array destructuring pattern";
        case 1356: return "Invaild destructuring";
        case 1362: return "Destructuring requires an initializer expression";
        case 1363: return "Only a single variable is allowed in a for...of statement";
        case 1364: return "Rest parameters are not supported in pebble, cosider using a concrete parameter with default value '[]'";
        case 1365: return "A test can only be specified at the top level of the file (it cannot be defined in functions etc.)";
        case 1365: return "Tests must be specified in a block statement";
        case 1366: return "Pattern expected.";
        case 1367: return "This case will never be evaluated because all patterns will be catched before";
        case 1368: return "Statement expected.";
        case 1369: return "Patterns may not have initializers or explicit types";
        case 1370: return "A 'case' expression must have at least one clause";
        case 1371: return "A 'match' statement must have at least one case";
        case 1372: return "Cases in a 'match' statement must be followed by other statements";
        case 1373: return "Variable declaration must have an initializer";
        case 1374: return "Deconstructed elements may not have initializers or explicit types";
        case 1375: return "Invalid field declaration.";
        case 1376: return "Field declarations must be typed.";
        case 1377: return "Type parameters must be identifiers.";
        case 1378: return "Invalid for statement update.";
        case 1379: return "The argument of a for...of statement must be an iterable.";
        case 1380: return "A 'fail' statement can only be used within a function body.";
        case 1381: return "An 'assert' statement can only be used within a function body.";
        case 1382: return "A 'test' statement can only be used outside a function.";
        case 1383: return "A 'match' statement can only be used within a function body.";
        case 1384: return "A value of type '{0}' cannot be deconstructed.";
        case 1385: return "The argument of a 'match' statement branch must be deconstructed.";
        case 1385: return "A value of type '{0}' cannot be deconstructed by named object.";
        case 1386: return "A value of type '{0}' cannot be deconstructed as unnamed object.";
        case 1387: return "A value of type '{0}' has multiple constructors";
        case 1388: return "Unknown '{0}' constructor '{1}'";
        case 1389: return "Constructor '{0}' was already specified";
        case 1390: return "A value of type '{0}' cannot be deconstructed as an array.";
        case 1391: return "Expression is not callable.";
        case 1392: return "Unexpected argument.";
        case 2300: return "Duplicate identifier '{0}'.";
        case 2304: return "Cannot find name '{0}'.";
        case 2305: return "Module '{0}' has no exported member '{1}'.";
        case 2306: return "File '{0}' has no exports.";
        case 2312: return "An interface can only extend an interface.";
        case 2314: return "Generic type '{0}' requires {1} type argument(s).";
        case 2315: return "Type '{0}' is not generic.";
        case 2322: return "Type '{0}' is not assignable to type '{1}'.";
        case 2325: return "Property '{0}' is private in type '{1}' but not in type '{2}'.";
        case 2329: return "Index signature is missing in type '{0}'.";
        case 2332: return "'this' cannot be referenced in current location.";
        case 2333: return "'this' cannot be referenced in constructor arguments.";
        case 2335: return "'super' can only be referenced in a derived class.";
        case 2336: return "'super' cannot be referenced in constructor arguments.";
        case 2337: return "Super calls are not permitted outside constructors or in nested functions inside constructors.";
        case 2339: return "Property '{0}' does not exist on type '{1}'.";
        case 2341: return "Property '{0}' is private and only accessible within class '{1}'.";
        case 2349: return "Cannot invoke an expression whose type lacks a call signature. Type '{0}' has no compatible call signatures.";
        case 2351: return "This expression is not constructable.";
        case 2355: return "A function whose declared type is not 'void' must return a value.";
        case 2357: return "The operand of an increment or decrement operator must be a variable.";
        case 2364: return "The left-hand side of an assignment expression must be a variable or a property access.";
        case 2365: return "Operator '{0}' cannot be applied to types '{1}' and '{2}'.";
        case 2376: return "A 'super' call must be the first statement in the constructor.";
        case 2377: return "Constructors for derived classes must contain a 'super' call.";
        case 2380: return "'get' and 'set' accessor must have the same type.";
        case 2385: return "Overload signatures must all be public, private or protected.";
        case 2390: return "Constructor implementation is missing.";
        case 2391: return "Function implementation is missing or not immediately following the declaration.";
        case 2392: return "Multiple constructor implementations are not allowed.";
        case 2393: return "Duplicate function implementation.";
        case 2394: return "This overload signature is not compatible with its implementation signature.";
        case 2416: return "Property '{0}' in type '{1}' is not assignable to the same property in base type '{2}'.";
        case 2422: return "A class can only implement an interface.";
        case 2434: return "A namespace declaration cannot be located prior to a class or function with which it is merged.";
        case 2442: return "Types have separate declarations of a private property '{0}'.";
        case 2444: return "Property '{0}' is protected in type '{1}' but public in type '{2}'.";
        case 2445: return "Property '{0}' is protected and only accessible within class '{1}' and its subclasses.";
        case 2448: return "Variable '{0}' used before its declaration.";
        case 2451: return "Cannot redeclare block-scoped variable '{0}'";
        case 2453: return "The type argument for type parameter '{0}' cannot be inferred from the usage. Consider specifying the type arguments explicitly.";
        case 2454: return "Variable '{0}' is used before being assigned.";
        case 2456: return "Type alias '{0}' circularly references itself.";
        case 2460: return "Type '{0}' has no property '{1}'.";
        case 2469: return "The '{0}' operator cannot be applied to type '{1}'.";
        case 2474: return "In 'const' enum declarations member initializer must be constant expression.";
        case 2506: return "'{0}' is referenced directly or indirectly in its own base expression.";
        case 2531: return "Object is possibly 'null'.";
        case 2540: return "Cannot assign to '{0}' because it is a constant.";
        case 2541: return "The target of an assignment must be a variable";
        case 2542: return "Index signature in type '{0}' only permits reading.";
        case 2554: return "Expected {0} arguments, but got {1}.";
        case 2555: return "Expected at least {0} arguments, but got {1}.";
        case 2558: return "Expected {0} type arguments, but got {1}.";
        case 2564: return "Property '{0}' has no initializer and is not assigned in the constructor before 'this' is used or returned.";
        case 2565: return "Property '{0}' is used before being assigned.";
        case 2673: return "Constructor of class '{0}' is private and only accessible within the class declaration.";
        case 2674: return "Constructor of class '{0}' is protected and only accessible within the class declaration.";
        case 2675: return "Cannot extend a class '{0}'. Class constructor is marked as private.";
        case 2685: return "The 'this' types of each signature are incompatible.";
        case 2695: return "Namespace can only have declarations.";
        case 2706: return "Required type parameters may not follow optional type parameters.";
        case 2718: return "Duplicate property '{0}'.";
        case 2741: return "Property '{0}' is missing in type '{1}' but required in type '{2}'.";
        case 2757: return "Type '{0}' has no call signatures.";
        case 2808: return "Get accessor '{0}' must be at least as accessible as the setter.";
        case 2809: return "Type parameter is unused.";
        case 2810: return "Assignments are statements, not expressions.";
        case 2811: return "Type parameter name must not match a native type name.";
        case 2812: return "Type '{0}' cannot be converted to type '{1}'.";
        case 2813: return "Non-null opeartor used on expression of type '{0}', which is not optional, this will be omitted during compilation.";
        case 6054: return "File '{0}' not found.";
        case 6055: return "Import path '{0}' is part of a circular dependency.";
        case 6188: return "Numeric separators are not allowed here.";
        case 6189: return "Multiple consecutive numeric separators are not permitted.";
        case 6234: return "This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?";
        case 17009: return "'super' must be called before accessing 'this' in the constructor of a derived class.";
        case 17011: return "'super' must be called before accessing a property of 'super' in the constructor of a derived class.";
        case 20000: return "Unkonwn AST node.";
        case 30001: return "Namespace '{0}' has no exported member '{1}'.";
        case 30002: return "Namespace path is incomplete; expected a value, type, function, or interface.";
        case 30003: return "'private' modifier is only allowed on declarations inside a namespace.";
        case 30004: return "Namespaces cannot be declared here.";
        case 30005: return "'{0}' is not a namespace.";
        case 30100: return "Enum members cannot have explicit values.";
        case 30101: return "Duplicate enum member '{0}'.";
        case 30102: return "Enum must have at least one member.";
        case 30103: return "Property '{0}' is not a member of enum '{1}'.";
        case 30104: return "Enum member pattern cannot have fields.";
        case 42069: return "Dev was too lazy to add a prooper error message. Something went wrong";
        default: return "";
    }
}
