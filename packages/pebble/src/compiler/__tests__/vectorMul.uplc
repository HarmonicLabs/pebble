(lam xs 
  (lam ys
    (case
      [
        (lam body_self 
          (case
            (constr 0
              [
                body_self,

                (con integer 0),

                ys,

                xs
              ]
            )
            [
              body_self
            ]

          )
        ) 
        (lam body_self 
          (lam body_result 
            (lam body_ys 
              (lam body_xs 
                (force 
                  (case
                    body_xs
                    [
                      (lam body_xs_head 
                        (lam body_xs_tail 
                          (case
                            body_ys
                            [
                              (lam body_ys_head 
                                (lam body_ys_tail 
                                  (delay 
                                    [
                                      (lam next_body_result 
                                        (case
                                          (constr 0
                                            [
                                              body_self,

                                              next_body_result,

                                              body_ys_tail,

                                              body_xs_tail
                                            ]
                                          )
                                          [
                                            body_self
                                          ]

                                        )
                                      ) 
                                      [
                                        [
                                          (builtin addInteger) 
                                          body_result
                                        ] 
                                        [
                                          [
                                            (builtin multiplyInteger) 
                                            body_xs_head
                                          ] 
                                          body_ys_head
                                        ]
                                      ]
                                    ]
                                  )
                                )
                              )
                            ]

                          )
                        )
                      ),

                      (delay 
                        (constr 0
                          [
                            body_result,

                            body_ys
                          ]
                        )
                      )
                    ]

                  )
                )
              )
            )
          )
        )
      ]
      [
        (lam body_self 
          (lam body_result 
            body_self
          )
        )
      ]

    )
  )
)
