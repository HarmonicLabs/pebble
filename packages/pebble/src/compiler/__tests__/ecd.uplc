[
  (lam isZero 
    [
      (lam ecd_self 
        [
          ecd_self 
          ecd_self
        ]
      ) 
      (lam ecd_self 
        (lam ecd_a 
          (lam ecd_b 
            (case
              [
                isZero 
                ecd_b
              ]
              [
                (case
                  (constr 0
                    [
                      ecd_self,

                      ecd_b,

                      [
                        [
                          (builtin modInteger) 
                          ecd_a
                        ] 
                        ecd_b
                      ]
                    ]
                  )
                  [
                    ecd_self
                  ]

                ),

                (case
                  [
                    [
                      (builtin lessThanEqualsInteger) 
                      (con integer 0)
                    ] 
                    ecd_a
                  ]
                  [
                    [
                      [
                        (builtin subtractInteger) 
                        (con integer 0)
                      ] 
                      ecd_a
                    ],

                    ecd_a
                  ]

                )
              ]

            )
          )
        )
      )
    ]
  ) 
  [
    (builtin equalsInteger) 
    (con integer 0)
  ]
]