
(case
  (constr 0)
  [
    [
      (lam ctx 
        (lam chooseList 
          (case
            (constr 0
              [
                (force (builtin headList)),

                (force (builtin tailList)),

                (force (force (builtin sndPair))),

                (force (builtin ifThenElse))
              ]
            )
            [
              (lam head
                (lam tail
                  (lam snd
                    (lam ifThenElse
                      [
                        (lam g 
                          [
                            (lam h 
                              (force 
                                (case
                                  (constr 0
                                    [
                                      [
                                        h 
                                        (con integer 1)
                                      ],

                                      (delay 
                                        (force 
                                          (case
                                            (constr 0
                                              [
                                                (case
                                                  (constr 0
                                                    [
                                                      [
                                                        (builtin equalsInteger) 
                                                        [
                                                          (builtin unIData) 
                                                          [
                                                            head 
                                                            [
                                                              snd 
                                                              [
                                                                (builtin unConstrData) 
                                                                [
                                                                  head 
                                                                  [
                                                                    tail 
                                                                    [
                                                                      snd 
                                                                      [
                                                                        (builtin unConstrData) 
                                                                        chooseList
                                                                      ]
                                                                    ]
                                                                  ]
                                                                ]
                                                              ]
                                                            ]
                                                          ]
                                                        ]
                                                      ],

                                                      (con (list integer) [1,2,3])
                                                    ]
                                                  )
                                                  [
                                                    (lam i 
                                                      (lam l 
                                                        [
                                                          [
                                                            l 
                                                            l
                                                          ] 
                                                          (lam m 
                                                            (lam o 
                                                              (force 
                                                                (case
                                                                  (constr 0
                                                                    [
                                                                      o,

                                                                      (delay 
                                                                        (con boolean False)
                                                                      ),

                                                                      (delay 
                                                                        (force 
                                                                          (case
                                                                            (constr 0
                                                                              [
                                                                                [
                                                                                  i 
                                                                                  [
                                                                                    head 
                                                                                    o
                                                                                  ]
                                                                                ],

                                                                                (delay 
                                                                                  (con boolean True)
                                                                                ),

                                                                                (delay 
                                                                                  [
                                                                                    [
                                                                                      m 
                                                                                      m
                                                                                    ] 
                                                                                    [
                                                                                      tail 
                                                                                      o
                                                                                    ]
                                                                                  ]
                                                                                )
                                                                              ]
                                                                            )
                                                                            [
                                                                              ifThenElse
                                                                            ]

                                                                          )
                                                                        )
                                                                      )
                                                                    ]
                                                                  )
                                                                  [
                                                                    ctx
                                                                  ]

                                                                )
                                                              )
                                                            )
                                                          )
                                                        ]
                                                      )
                                                    )
                                                  ]

                                                ),

                                                (delay 
                                                  (con unit ())
                                                ),

                                                (delay (error)
                                                )
                                              ]
                                            )
                                            [
                                              ifThenElse
                                            ]

                                          )
                                        )
                                      ),

                                      (delay (error)
                                      )
                                    ]
                                  )
                                  [
                                    ifThenElse
                                  ]

                                )
                              )
                            ) 
                            [
                              (builtin equalsInteger) 
                              [
                                (force (force (builtin fstPair))) 
                                g
                              ]
                            ]
                          ]
                        ) 
                        [
                          (builtin unConstrData) 
                          [
                            head 
                            [
                              (lam g 
                                [
                                  tail 
                                  [
                                    tail 
                                    g
                                  ]
                                ]
                              ) 
                              [
                                snd 
                                [
                                  (builtin unConstrData) 
                                  chooseList -- not supposed to be this var
                                ]
                              ]
                            ]
                          ]
                        ]
                      ]
                    )
                  )
                )
              )
            ]

          )
        )
      ) 
      (force (force (builtin chooseList)))
    ],

    (con integer 42)
  ]

)