import { PExtended, PInterval, PBound, PScriptContext, PBound, bool, int, pData, pDataI, peqInt, perror, pfn, phoist, plet, pmatch, pstruct, psub, punsafeConvertType } from "../..";
import { Machine, CEKConst } from "@harmoniclabs/plutus-machine";
import { DataConstr, dataFromCbor } from "@harmoniclabs/plutus-data";

/*
const getFinite = phoist(
    pfn([
        PExtended.type
    ], int)
    ( extended =>
        pmatch( extended )
        .onPFinite(({ _0 }) => _0)
        ._( _ => perror( int ) )
    )
);
//*/

describe("tx interval", () => {
    
    test("eq bounds", () => {
    
        const thing = pfn([
            PInterval.type
        ],  bool)
        (( interval) => {
        
            const from =
            // plet(
                pmatch( interval.from.bound )
                .onPFinite(({ _0 }) => _0)
                ._( _ => perror( int ))
            // )
        
        
            const to =
            // plet(
                pmatch( interval.to.bound )
                .onPFinite(({ _0 }) => _0)
                ._( _ => perror( int ))
            // )
    
            const time_diff =
            plet(
                peqInt.$( to ).$( from )
            )
        
            return time_diff;
        });
    
        const ir = thing.toIR();
    
        const uplc = thing.$(
            PInterval.PInterval({
                from: PBound.PBound({
                    bound: PExtended.PFinite({ _0: pDataI(10) }) as any,
                    inclusive: pData( new DataConstr(0,[]) )
                }) as any,
                to: PBound.PBound({
                    bound: PExtended.PFinite({ _0: pDataI(10) }) as any,
                    inclusive: pData( new DataConstr(0,[]) )
                }) as any
            })
        ).toUPLC();
    
        // console.log( prettyUPLC( uplc ) );
        // console.log( prettyIRJsonStr( ir ) );
    
        const { result } = Machine.eval( uplc );
    
        // console.log( result );
        // console.log(
        //     (result as any)?.addInfos?.data ??
        //     (result as any)?.addInfos?.list ??
        //     (result as any)?.addInfos
        // );
    
        expect( result instanceof CEKConst ).toBe( true );
    });

    describe("from ctx", () => {

        test("eq bounds", () => {

            const thing = pfn([
                PScriptContext.type
            ],  bool)
            (({ tx: { interval }}) => {
            
                const from =
                // plet(
                    pmatch( interval.from.bound )
                    .onPFinite(({ _0 }) => _0)
                    ._( _ => perror( int ))
                // )
            
            
                const to =
                // plet(
                    pmatch( interval.to.bound )
                    .onPFinite(({ _0 }) => _0)
                    ._( _ => perror( int ))
                // )
        
                const time_diff =
                plet(
                    peqInt.$( to ).$( from )
                )
            
                return time_diff;
            });
        
            const ir = thing.toIR();
            // console.log( prettyIRJsonStr( ir ) );
        
            const uplc = thing.$(
                PScriptContext.fromData(pData(
                    dataFromCbor(
                        "d8799fd8799f9fd8799fd8799fd8799f582012cc3906a43731477e63522a24cbb5eaf74046bf7b44f600d8f062ecac331b71ff00ffd8799fd8799fd87a9f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffd87a80ffbf40bf401a001898f4ff581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278bf466974616d616501ffffd87b9fd8799f00582071eb1a4896739027745df976a065ded7ffd4e6371a2a9256999f59371b50b36a0519ffff001b0000018a5b512a340080ffffd87a80ffffd8799fd8799fd8799f5820fbbce31d47e45af499baff9446c99ccbc2e80db613467dbc5ffea2f3bb10a8a2ff01ffd8799fd8799fd8799f581c13867b04db054caa9655378fe37fedee7029924fbe1243887dc35fd8ffd87a80ffbf40bf401b000000024efc84ffffffd87980d87a80ffffff9fd8799fd8799fd8799f5820fbbce31d47e45af499baff9446c99ccbc2e80db613467dbc5ffea2f3bb10a8a2ff00ffd8799fd8799fd87a9f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffd87a80ffbf40bf401a0128cce6ffffd87b9f00ffd8799f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffffffd8799fd8799fd8799f5820fbbce31d47e45af499baff9446c99ccbc2e80db613467dbc5ffea2f3bb10a8a2ff00ffd8799fd8799fd87a9f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffd87a80ffbf40bf401a0128cce6ffffd87b9f00ffd8799f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffffffff9fd8799fd8799fd87a9f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffd87a80ffbf40bf401a001898f4ff581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278bf466974616d616501ffffd87b9fd8799f01582000000f3b69e1436d48366f34c2e217cf598dc2f886d7dc5bb56688b8365a748b0519ffff1a000a75bc1b0000018a5b5b9ff00080ffffd87a80ffd8799fd8799fd8799f581c13867b04db054caa9655378fe37fedee7029924fbe1243887dc35fd8ffd87a80ffbf40bf401b000000024ef9ac02ff581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278bf4754454d505552411b000000012a05f200ffffd87980d87a80ffffbf40bf401a0002d8fdffffbf40bf4000ff581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278bf4754454d505552411b000000012a05f200ffff80a0d8799fd8799fd87a9f1b0000018a5b5a4060ffd87980ffd8799fd87a9f1b0000018a5b5cff80ffd87980ffff80bfd87a9fd8799fd8799f582012cc3906a43731477e63522a24cbb5eaf74046bf7b44f600d8f062ecac331b71ff00ffffd87a9f50842b09bb0f88bf1232901043701534ceffd8799f581cc9981006c4abf1eab96a0c87b0ee3d40b8007cd4c9b3d0dea357c278ffd87980ffa05820198ca261bc2c0f39e64132c19cd2b2e38dffc4f5594ec195d8750013f73f1b7bffd87a9fd8799fd8799f582012cc3906a43731477e63522a24cbb5eaf74046bf7b44f600d8f062ecac331b71ff00ffffff"
                    )
                ))
            ).toUPLC();
        
            // console.log( prettyUPLC( uplc ) );
        
            const { result } = Machine.eval( uplc );
        
            // console.log( result );
            // console.log(
            //     (result as any)?.addInfos?.data ??
            //     (result as any)?.addInfos?.list ??
            //     (result as any)?.addInfos
            // );
        
            expect( result instanceof CEKConst ).toBe( true );
        });

    })

})